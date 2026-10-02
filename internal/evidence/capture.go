package evidence

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"shardyssey/internal/traces"
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
	Root         string
	ExperimentID string
	DelayMS      int
	DSN          string
	Jaeger       string
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
	switch c.ExperimentID {
	case "", "one-shard", "fan-out", "slow-branch":
	default:
		return "", nil, fmt.Errorf("unknown experiment %q", c.ExperimentID)
	}
	if c.DelayMS == 0 {
		c.DelayMS = 500
	}
	if c.DelayMS < 100 || c.DelayMS > 1000 {
		return "", nil, fmt.Errorf("delay must be 100–1000 ms")
	}
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
	directory = filepath.Join(c.Root, "fixtures", time.Now().UTC().Format("20060102T150405.000000000Z"))
	if err = os.Mkdir(directory, 0755); err != nil {
		return
	}
	if err = saveJSON(filepath.Join(directory, "capture-status.json"), map[string]any{"status": "capturing"}); err != nil {
		return
	}
	defer func() {
		status := map[string]any{"status": "complete"}
		if report != nil {
			status["gate"] = report.Gate
		}
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
	if err = saveJSON(filepath.Join(directory, "environment.json"), map[string]any{
		"layout": "separate containers on one host", "clock_uncertainty_us": nil,
		"clock_source": "shared host kernel clock; skew not separately measured",
	}); err != nil {
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
		if c.ExperimentID != "" && experiment.name != c.ExperimentID {
			continue
		}
		if err = c.experiment(ctx, filepath.Join(directory, experiment.name), experiment.name, experiment.query, experiment.delayed); err != nil {
			return
		}
	}
	if c.ExperimentID != "" {
		return
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
		delay := c.DelayMS
		if delay == 0 {
			delay = 500
		}
		if delay < 100 || delay > 1000 {
			return fmt.Errorf("delay must be 100–1000 ms")
		}
		fault = map[string]any{"type": "injected network delay", "shard": "80-", "delay_ms": delay}
		if _, err = c.script(ctx, "fault.sh", "on", strconv.Itoa(delay)); err != nil {
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
	raw, retrievalError := Retrieve(ctx, c.Jaeger, execution.Start, execution.End)
	if len(raw) > 0 {
		if err = os.WriteFile(filepath.Join(directory, "jaeger.json"), raw, 0644); err != nil {
			return
		}
	}
	if retrievalError != nil {
		return retrievalError
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

// Retrieve remains available to evidence callers; trace export lives in traces.
func Retrieve(ctx context.Context, endpoint string, start, end int64) ([]byte, error) {
	return traces.Retrieve(ctx, endpoint, start, end)
}
