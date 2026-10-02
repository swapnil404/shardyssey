package evidence

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

const maxEvidence = 32 << 20

type evidenceBuffer struct{ bytes.Buffer }

func (b *evidenceBuffer) Write(p []byte) (int, error) {
	if len(p) > maxEvidence-b.Len() {
		return 0, fmt.Errorf("command output exceeds evidence size limit")
	}
	return b.Buffer.Write(p)
}

type Capturer struct {
	Root   string
	DSN    string
	Jaeger string
}

func (c Capturer) command(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, args[0], args[1:]...)
	command.Dir = c.Root
	var stdout, stderr evidenceBuffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if e := command.Run(); e != nil {
		return nil, fmt.Errorf("%s: %w: %s", args[0], e, stderr.String())
	}
	return stdout.Bytes(), nil
}
func (c Capturer) script(ctx context.Context, name string, args ...string) ([]byte, error) {
	return c.command(ctx, append([]string{filepath.Join(c.Root, "demo", name)}, args...)...)
}
func (c Capturer) commandFile(ctx context.Context, path, script string, args ...string) error {
	b, e := c.script(ctx, script, args...)
	if e != nil {
		return e
	}
	return os.WriteFile(path, b, 0644)
}
func newID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// Capture saves raw query results, topology, explain output, and traces.
func (c Capturer) Capture(ctx context.Context) (directory string, report *Report, err error) {
	c.Root, err = filepath.Abs(c.Root)
	if err != nil {
		return
	}
	lock, e := os.OpenFile(filepath.Join(os.TempDir(), "shardyssey-capture.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		err = e
		return
	}
	defer lock.Close()
	if e = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		err = fmt.Errorf("another capture is active: %w", e)
		return
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	directory = filepath.Join(c.Root, "fixtures", time.Now().UTC().Format("20060102T150405Z"))
	if err = os.Mkdir(directory, 0755); err != nil {
		return
	}
	if err = saveJSON(filepath.Join(directory, "capture-status.json"), map[string]any{"status": "capturing"}); err != nil {
		return
	}
	defer func() {
		status := map[string]any{"status": "complete", "gate": "passed"}
		if err != nil {
			status = map[string]any{"status": "failed", "warning": err.Error(), "usable_for_timed_replay": false}
		}
		err = errors.Join(err, saveJSON(filepath.Join(directory, "capture-status.json"), status))
	}()
	images, e := os.ReadFile(filepath.Join(c.Root, "demo/images.env"))
	if e != nil {
		err = e
		return
	}
	if err = os.WriteFile(filepath.Join(directory, "images.env"), images, 0644); err != nil {
		return
	}
	version, e := c.command(ctx, "docker", "compose", "--env-file", filepath.Join(c.Root, "demo/images.env"), "-f", filepath.Join(c.Root, "demo/compose.yaml"), "exec", "-T", "vtgate", "vtgate", "--version")
	if e != nil {
		err = e
		return
	}
	if err = os.WriteFile(filepath.Join(directory, "version.txt"), version, 0644); err != nil {
		return
	}
	for _, alias := range []string{"local-0000000100", "local-0000000200"} {
		if err = c.commandFile(ctx, filepath.Join(directory, "topology-"+alias+".json"), "cluster.sh", "ctl", "GetTablet", alias); err != nil {
			return
		}
	}
	for _, item := range []struct{ file, command string }{{"vschema.json", "GetVSchema"}, {"shards.json", "FindAllShardsInKeyspace"}} {
		if err = c.commandFile(ctx, filepath.Join(directory, item.file), "cluster.sh", "ctl", item.command, "demo"); err != nil {
			return
		}
	}
	for _, shard := range []string{"-80", "80-"} {
		if err = c.commandFile(ctx, filepath.Join(directory, "seed-"+shard+".tsv"), "cluster.sh", "sql", "-e", fmt.Sprintf("USE `demo:%s`; SELECT user_id, event_id, category FROM events ORDER BY user_id, event_id", shard)); err != nil {
			return
		}
	}
	if _, err = c.script(ctx, "fault.sh", "off"); err != nil {
		return
	}
	for _, experiment := range []struct {
		name, query string
		delayed     bool
	}{{"one-shard", "SELECT COUNT(*) FROM events WHERE user_id = 42", false}, {"fan-out", "SELECT COUNT(*) FROM events", false}, {"slow-branch", "SELECT COUNT(*) FROM events", true}} {
		if err = c.experiment(ctx, filepath.Join(directory, experiment.name), experiment.name, experiment.query, experiment.delayed); err != nil {
			return
		}
	}
	report, err = Audit(directory)
	if err != nil {
		return
	}
	err = saveJSON(filepath.Join(directory, "gate-report.json"), report)
	return
}

func (c Capturer) experiment(ctx context.Context, directory, name, query string, delayed bool) (err error) {
	if err = os.Mkdir(directory, 0755); err != nil {
		return
	}
	// Cleanup gets its own deadline: cancellation of the query cannot cancel cleanup.
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, e := c.script(cleanup, "fault.sh", "off")
		if e == nil {
			e = c.commandFile(cleanup, filepath.Join(directory, "fault-cleanup.txt"), "fault.sh", "status")
		}
		err = errors.Join(err, e)
	}()
	var fault any
	if delayed {
		fault = map[string]any{"type": "injected network delay", "shard": "80-", "delay_ms": 500}
		if _, err = c.script(ctx, "fault.sh", "on", "500"); err != nil {
			return
		}
	}
	if err = c.commandFile(ctx, filepath.Join(directory, "fault-before.txt"), "fault.sh", "status"); err != nil {
		return
	}
	// Complete connection setup before opening the query correlation interval.
	db, e := sql.Open("mysql", c.DSN)
	if e != nil {
		return e
	}
	defer db.Close()
	setup, cancel := context.WithTimeout(ctx, 5*time.Second)
	connection, e := db.Conn(setup)
	if e == nil {
		defer connection.Close()
		e = connection.PingContext(setup)
	}
	cancel()
	if e != nil {
		return e
	}
	queryContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	start := time.Now()
	result, e := queryTSV(queryContext, connection, query)
	end := time.Now()
	if e != nil {
		return e
	}
	execution := Execution{RunID: newID(), Experiment: name, SQL: query, Start: start.UnixMicro(), End: end.UnixMicro(), Elapsed: float64(end.Sub(start)) / float64(time.Millisecond), Scope: "query and row retrieval on an established MySQL connection", Fault: fault, Correlation: "single executor trace in isolated query interval"}
	if err = os.WriteFile(filepath.Join(directory, "result.tsv"), result, 0644); err != nil {
		return
	}
	if err = saveJSON(filepath.Join(directory, "execution.json"), execution); err != nil {
		return
	}
	raw, e := Retrieve(ctx, c.Jaeger, execution.Start, execution.End)
	if e != nil {
		return e
	}
	if err = os.WriteFile(filepath.Join(directory, "jaeger.json"), raw, 0644); err != nil {
		return
	}
	if err = c.commandFile(ctx, filepath.Join(directory, "fault-after-query.txt"), "fault.sh", "status"); err != nil {
		return
	}
	for _, format := range []string{"PLAN", "QUERIES", "TRACE"} {
		prefix := filepath.Join(directory, "vexplain-"+strings.ToLower(format))
		if err = c.commandFile(ctx, prefix+".tsv", "cluster.sh", "sql", "-e", "VEXPLAIN "+format+" "+query); err != nil {
			return
		}
		if err = saveJSON(prefix+".json", map[string]any{"run_id": newID(), "ordinary_run_id": execution.RunID, "format": format, "sql": query, "separate_execution": true}); err != nil {
			return
		}
	}
	return nil
}

func queryTSV(ctx context.Context, connection *sql.Conn, query string) ([]byte, error) {
	rows, e := connection.QueryContext(ctx, query)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	columns, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	var result bytes.Buffer
	result.WriteString(strings.Join(columns, "\t") + "\n")
	for rows.Next() {
		values := make([]sql.RawBytes, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if e = rows.Scan(targets...); e != nil {
			return nil, e
		}
		for i, value := range values {
			if i > 0 {
				result.WriteByte('\t')
			}
			result.Write(value)
		}
		result.WriteByte('\n')
		if result.Len() > maxEvidence {
			return nil, fmt.Errorf("query result exceeds size limit")
		}
	}
	return result.Bytes(), rows.Err()
}

func fingerprint(trace Trace) string {
	spans := append([]Span(nil), trace.Spans...)
	sort.Slice(spans, func(i, j int) bool { return spans[i].ID < spans[j].ID })
	var result strings.Builder
	for _, span := range spans {
		refs := append([]Reference(nil), span.References...)
		sort.Slice(refs, func(i, j int) bool { return refs[i].SpanID < refs[j].SpanID })
		fmt.Fprintf(&result, "%s/%d/%d/%v;", span.ID, span.Start, span.Duration, refs)
	}
	return result.String()
}

// Retrieve preserves the complete raw candidate, including unknown fields and repeated RPCs.
func Retrieve(ctx context.Context, endpoint string, start, end int64) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := http.Client{Timeout: 5 * time.Second}
	previous := ""
	params := url.Values{"service": {"vtgate"}, "start": {strconv.FormatInt(start, 10)}, "end": {strconv.FormatInt(end, 10)}, "limit": {"100"}}
	for {
		request, e := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint, "/")+"/api/traces?"+params.Encode(), nil)
		if e != nil {
			return nil, e
		}
		response, e := client.Do(request)
		if e != nil {
			return nil, e
		}
		body, e := io.ReadAll(io.LimitReader(response.Body, maxEvidence+1))
		response.Body.Close()
		if e != nil {
			return nil, e
		}
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("Jaeger returned HTTP %d", response.StatusCode)
		}
		if len(body) > maxEvidence {
			return nil, fmt.Errorf("trace response exceeds size limit")
		}
		var raw struct {
			Data   []json.RawMessage `json:"data"`
			Errors json.RawMessage   `json:"errors"`
		}
		if e = json.Unmarshal(body, &raw); e != nil {
			return nil, e
		}
		if len(raw.Errors) > 0 && string(raw.Errors) != "null" && string(raw.Errors) != "[]" {
			return nil, fmt.Errorf("Jaeger search errors: %s", raw.Errors)
		}
		var candidates []json.RawMessage
		var candidate Trace
		for _, item := range raw.Data {
			var trace Trace
			if e = json.Unmarshal(item, &trace); e != nil {
				return nil, e
			}
			for _, span := range trace.Spans {
				if (span.Operation == "executor.Execute" || span.Operation == "executor.StreamExecute") && span.Start >= start && span.Start <= end {
					candidates = append(candidates, item)
					candidate = trace
					break
				}
			}
		}
		if len(candidates) > 1 {
			return nil, fmt.Errorf("ambiguous query correlation: multiple executor traces in isolated interval")
		}
		if len(candidates) == 1 {
			current := fingerprint(candidate)
			if current == previous {
				raw.Data = candidates
				output, e := json.MarshalIndent(raw, "", "  ")
				return append(output, '\n'), e
			}
			previous = current
		} else {
			previous = ""
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("trace export did not stabilize: %w", ctx.Err())
		case <-time.After(time.Second):
		}
	}
}
