package evidence

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func rows(path string) ([]string, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) < 2 {
		return nil, fmt.Errorf("%s: no rows", path)
	}
	return lines[1:], nil
}
func Audit(directory string) (*Report, error) {
	topology := map[string]string{}
	paths, e := filepath.Glob(filepath.Join(directory, "topology-*.json"))
	if e != nil {
		return nil, e
	}
	for _, path := range paths {
		var raw struct {
			Tablet *struct {
				Alias struct {
					Cell string     `json:"cell"`
					UID  jsonNumber `json:"uid"`
				} `json:"alias"`
				Keyspace string `json:"keyspace"`
				Shard    string `json:"shard"`
			} `json:"tablet"`
		}
		// vtctldclient GetTablet returns the tablet directly.
		var tablet struct {
			Alias struct {
				Cell string     `json:"cell"`
				UID  jsonNumber `json:"uid"`
			} `json:"alias"`
			Keyspace string `json:"keyspace"`
			Shard    string `json:"shard"`
		}
		if e = readJSON(path, &raw); e != nil {
			return nil, e
		}
		if raw.Tablet != nil {
			tablet = *raw.Tablet
		} else if e = readJSON(path, &tablet); e != nil {
			return nil, e
		}
		uid, e := strconv.ParseUint(string(tablet.Alias.UID), 10, 32)
		if e != nil {
			return nil, e
		}
		if tablet.Keyspace != "demo" || (tablet.Shard != "-80" && tablet.Shard != "80-") {
			return nil, fmt.Errorf("invalid topology %s", path)
		}
		topology[fmt.Sprintf("%s-%010d", tablet.Alias.Cell, uid)] = tablet.Shard
	}
	if len(topology) != 2 {
		return nil, fmt.Errorf("require two tablet identities")
	}
	counts := map[string]int{}
	for _, shard := range topology {
		counts[shard]++
	}
	if counts["-80"] != 1 || counts["80-"] != 1 {
		return nil, fmt.Errorf("require one tablet per shard")
	}
	total := 0
	for _, shard := range []string{"-80", "80-"} {
		r, e := rows(filepath.Join(directory, "seed-"+shard+".tsv"))
		if e != nil {
			return nil, e
		}
		total += len(r)
	}
	if total != 20 {
		return nil, fmt.Errorf("expected 20 seed rows, got %d", total)
	}
	report := &Report{Gate: "passed", Layout: "separate containers on one host", Clock: "shared host kernel clock; original Jaeger microsecond timestamps preserved", Experiments: map[string]ExperimentReport{}}
	for _, name := range []string{"one-shard", "fan-out", "slow-branch"} {
		r, e := auditExperiment(directory, name, topology)
		if e != nil {
			return nil, fmt.Errorf("%s: %w", name, e)
		}
		report.Experiments[name] = r
	}
	baseline, slow := report.Experiments["fan-out"], report.Experiments["slow-branch"]
	byShard := func(r ExperimentReport) map[string]Branch {
		m := map[string]Branch{}
		for _, b := range r.Branches {
			m[b.Shard] = b
		}
		return m
	}
	b, s := byShard(baseline), byShard(slow)
	right := s["80-"].RPCDuration - b["80-"].RPCDuration
	left := s["-80"].RPCDuration - b["-80"].RPCDuration
	if right < 400 || math.Abs(left) >= 150 || slow.Duration-baseline.Duration < 400 || slow.Duration < s["80-"].RPCDuration-1 || slow.Elapsed < slow.Duration-1 {
		return nil, fmt.Errorf("delay effect or completion interval inconsistent")
	}
	report.Delay = map[string]float64{"80-": right, "-80": left, "root": slow.Duration - baseline.Duration}
	return report, nil
}

type jsonNumber string

func (n *jsonNumber) UnmarshalJSON(b []byte) error {
	*n = jsonNumber(strings.Trim(string(b), "\""))
	return nil
}

func auditExperiment(directory, name string, topology map[string]string) (ExperimentReport, error) {
	fail := func(message string) (ExperimentReport, error) { return ExperimentReport{}, fmt.Errorf("%s", message) }
	folder := filepath.Join(directory, name)
	var execution Execution
	if e := readJSON(filepath.Join(folder, "execution.json"), &execution); e != nil {
		return ExperimentReport{}, e
	}
	expected := 20
	expectedBranches := 2
	if name == "one-shard" {
		expected = 2
		expectedBranches = 1
	}
	result, e := rows(filepath.Join(folder, "result.tsv"))
	if e != nil {
		return ExperimentReport{}, e
	}
	if len(result) != 1 || result[0] != strconv.Itoa(expected) {
		return fail("unexpected query result")
	}
	var response Response
	if e = readJSON(filepath.Join(folder, "jaeger.json"), &response); e != nil {
		return ExperimentReport{}, e
	}
	if len(response.Data) != 1 || (len(response.Errors) > 0 && !bytes.Equal(response.Errors, []byte("null")) && !bytes.Equal(response.Errors, []byte("[]"))) {
		return fail("require one error-free query trace")
	}
	trace := response.Data[0]
	spans := map[string]Span{}
	var roots []Span
	for _, s := range trace.Spans {
		if _, ok := spans[s.ID]; ok {
			return fail("duplicate span ID")
		}
		if s.ID == "" || s.TraceID != trace.ID || s.Duration < 0 || len(s.Warnings) > 0 || attr(s.Tags, "error") == true {
			return fail("invalid or failed span")
		}
		if _, ok := trace.Processes[s.ProcessID]; !ok {
			return fail("unknown span process")
		}
		spans[s.ID] = s
		if len(s.References) == 0 {
			roots = append(roots, s)
		}
	}
	if len(roots) != 1 {
		return fail("require a complete single root trace")
	}
	root := roots[0]
	if root.Operation != "vtgateHandler.ComQuery" || trace.Processes[root.ProcessID].Service != "vtgate" || root.Start < execution.Start || root.Start > execution.End || root.Start+root.Duration > execution.End+1000 {
		return fail("invalid root operation or query interval")
	}
	for _, span := range spans {
		for _, ref := range span.References {
			parent, ok := spans[ref.SpanID]
			if !ok || ref.TraceID != trace.ID {
				return fail("missing parent")
			}
			if span.Start < parent.Start-1000 || span.Start+span.Duration > parent.Start+parent.Duration+1000 {
				return fail("unexpected clock ordering")
			}
		}
	}
	// Require every span to reach the root, including non-tablet operations.
	for _, span := range spans {
		seen := map[string]bool{}
		cursor := span
		for cursor.ID != root.ID {
			if seen[cursor.ID] {
				return fail("cyclic ancestry")
			}
			seen[cursor.ID] = true
			var parents []Reference
			for _, ref := range cursor.References {
				if ref.Type == "CHILD_OF" {
					parents = append(parents, ref)
				}
			}
			if len(parents) != 1 {
				return fail("require a single parent")
			}
			cursor = spans[parents[0].SpanID]
		}
	}
	branches := []Branch{}
	for _, span := range trace.Spans {
		process := trace.Processes[span.ProcessID]
		shard, ok := attr(span.Tags, "shard").(string)
		if process.Service != "vttablet" || (span.Operation != "TabletServer.Execute" && span.Operation != "TabletServer.StreamExecute") || !ok {
			continue
		}
		alias, _ := attr(process.Tags, "service.instance.id").(string)
		mapped, ok := topology[alias]
		if !ok {
			return fail("unknown tablet resource identity")
		}
		if shard != mapped || attr(span.Tags, "keyspace") != "demo" {
			return fail("tablet attributes disagree with topology")
		}
		cursor := span
		var client *Span
		for cursor.ID != root.ID {
			for _, ref := range cursor.References {
				if ref.Type == "CHILD_OF" {
					cursor = spans[ref.SpanID]
					break
				}
			}
			if trace.Processes[cursor.ProcessID].Service == "vtgate" && attr(cursor.Tags, "span.kind") == "client" {
				copy := cursor
				client = &copy
			}
		}
		if client == nil {
			return fail("missing measured gateway RPC interval")
		}
		branches = append(branches, Branch{Shard: shard, Tablet: alias, TabletSpan: span.ID, RPCSpan: client.ID, Start: client.Start, RPCDuration: float64(client.Duration) / 1000, TabletDuration: float64(span.Duration) / 1000, Identity: "service.instance.id + tablet shard attribute + captured topology"})
	}
	if len(branches) != expectedBranches {
		return fail("unexpected/missing/retried tablet executions; inspect raw trace")
	}
	explained := map[string]bool{}
	lines, e := rows(filepath.Join(folder, "vexplain-queries.tsv"))
	if e != nil {
		return ExperimentReport{}, e
	}
	for _, line := range lines {
		columns := strings.Split(line, "\t")
		if len(columns) < 4 {
			return fail("invalid VEXPLAIN row")
		}
		explained[columns[2]] = true
	}
	observed := map[string]bool{}
	for _, b := range branches {
		observed[b.Shard] = true
		if !explained[b.Shard] {
			return fail("trace and VEXPLAIN routes disagree")
		}
	}
	if len(observed) != expectedBranches || len(explained) != len(observed) {
		return fail("trace and VEXPLAIN branch counts disagree")
	}
	if name == "one-shard" {
		seed, e := rows(filepath.Join(directory, "seed-"+branches[0].Shard+".tsv"))
		if e != nil {
			return ExperimentReport{}, e
		}
		count := 0
		for _, row := range seed {
			if strings.HasPrefix(row, "42\t") {
				count++
			}
		}
		if count != 2 {
			return fail("one-shard route does not contain user 42")
		}
	}
	ids := map[string]bool{execution.RunID: true}
	for _, format := range []string{"plan", "queries", "trace"} {
		var explain struct {
			ID       string `json:"run_id"`
			Separate bool   `json:"separate_execution"`
		}
		if e = readJSON(filepath.Join(folder, "vexplain-"+format+".json"), &explain); e != nil {
			return ExperimentReport{}, e
		}
		if !explain.Separate || explain.ID == "" || ids[explain.ID] {
			return fail("VEXPLAIN requires separate execution IDs")
		}
		ids[explain.ID] = true
	}
	cleanup, e := os.ReadFile(filepath.Join(folder, "fault-cleanup.txt"))
	if e != nil {
		return ExperimentReport{}, e
	}
	if bytes.Contains(cleanup, []byte("netem")) || bytes.Contains(cleanup, []byte("prio 1:")) {
		return fail("network delay not cleaned up")
	}
	sort.Slice(branches, func(i, j int) bool { return branches[i].Shard < branches[j].Shard })
	return ExperimentReport{RunID: execution.RunID, TraceID: trace.ID, RootID: root.ID, Duration: float64(root.Duration) / 1000, Elapsed: execution.Elapsed, Branches: branches}, nil
}
