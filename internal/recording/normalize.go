package recording

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const maxEvidenceBytes = 32 << 20

var experiments = []string{"one-shard", "fan-out", "slow-branch"}
var queries = map[string]string{"one-shard": "SELECT COUNT(*) FROM events WHERE user_id = 42", "fan-out": "SELECT COUNT(*) FROM events", "slow-branch": "SELECT COUNT(*) FROM events"}

func ptr[T any](value T) *T { return &value }
func load(path string) ([]byte, error) {
	info, e := os.Stat(path)
	if e != nil {
		return nil, e
	}
	if info.Size() > maxEvidenceBytes {
		return nil, fmt.Errorf("%s exceeds evidence size limit", path)
	}
	return os.ReadFile(path)
}
func decode(path string, value any) error {
	b, e := load(path)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, value); e != nil {
		return fmt.Errorf("%s: %w", path, e)
	}
	return nil
}
func (r *Recording) warn(code, message string, id *string) {
	r.Warnings = append(r.Warnings, Warning{code, message, id})
	r.CaptureStatus = "incomplete"
}

// Normalize imports a local evidence directory without contacting Vitess or Jaeger.
func Normalize(directory, experiment string) (*Recording, error) {
	if _, ok := queries[experiment]; !ok {
		return nil, fmt.Errorf("unknown experiment %q", experiment)
	}
	folder := filepath.Join(directory, experiment)
	r := &Recording{SchemaVersion: SchemaVersion, ExperimentID: experiment, CaptureStatus: "complete", Parameters: map[string]any{}, RawEvidencePaths: map[string]string{}, Spans: []Span{}, Branches: []Branch{}, ExplainRuns: []ExplainRun{}, Warnings: []Warning{}, TimestampUnit: "unix_microseconds", TopologySnapshot: Topology{Tablets: []Tablet{}}}
	var execution struct {
		RunID      *string         `json:"run_id"`
		Experiment string          `json:"experiment_id"`
		SQL        *string         `json:"sql"`
		Start      *int64          `json:"start_unix_us"`
		End        *int64          `json:"end_unix_us"`
		Elapsed    *float64        `json:"client_elapsed_ms"`
		Fault      json.RawMessage `json:"fault_configuration"`
	}
	if e := decode(filepath.Join(folder, "execution.json"), &execution); e != nil {
		if !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
		r.warn("missing_execution", "Query identity, result timing, and parameters are unavailable.", nil)
	} else {
		if execution.Experiment != experiment || execution.SQL == nil || *execution.SQL != queries[experiment] || execution.RunID == nil || *execution.RunID == "" {
			return nil, fmt.Errorf("execution does not match the allowed experiment")
		}
		r.RunID = execution.RunID
		r.QueryTemplate = execution.SQL
		r.ClientElapsedMS = execution.Elapsed
		r.FaultConfiguration = execution.Fault
		r.RawEvidencePaths["execution"] = "execution.json"
		if experiment == "one-shard" {
			r.Parameters["user_id"] = 42
		}
		if execution.Elapsed == nil || *execution.Elapsed < 0 || execution.Start == nil || execution.End == nil || *execution.End < *execution.Start {
			r.warn("missing_client_timing", "Client timing is missing or invalid.", nil)
		}
	}
	version, e := load(filepath.Join(directory, "version.txt"))
	if e == nil {
		match := regexp.MustCompile(`Version: ([0-9]+\.[0-9]+\.[0-9]+)`).FindStringSubmatch(string(version))
		if len(match) == 2 {
			r.VitessVersion = ptr(match[1])
		}
		r.RawEvidencePaths["version"] = "../version.txt"
	} else if !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	if r.VitessVersion == nil {
		r.warn("missing_version", "Vitess version is unavailable.", nil)
	}
	if e = readTopology(directory, r); e != nil {
		return nil, e
	}
	if e = readResult(folder, r); e != nil {
		return nil, e
	}
	if e = readExplain(folder, r); e != nil {
		return nil, e
	}
	traceBytes, e := load(filepath.Join(folder, "jaeger.json"))
	if errors.Is(e, os.ErrNotExist) {
		r.warn("missing_trace", "No query trace was captured; absent branches cannot establish that a shard did not run.", nil)
	} else if e != nil {
		return nil, e
	} else {
		r.RawEvidencePaths["trace"] = "jaeger.json"
		if e = normalizeTrace(traceBytes, r, execution.Start, execution.End); e != nil {
			return nil, e
		}
	}
	cleanup, e := load(filepath.Join(folder, "fault-cleanup.txt"))
	if e == nil {
		r.RawEvidencePaths["fault_cleanup"] = "fault-cleanup.txt"
		if strings.Contains(string(cleanup), "netem") || strings.Contains(string(cleanup), "prio 1:") {
			r.warn("fault_cleanup_failed", "Injected network delay remains active in the cleanup evidence.", nil)
		}
	} else if errors.Is(e, os.ErrNotExist) {
		r.warn("missing_fault_cleanup", "Fault cleanup was not recorded.", nil)
	} else {
		return nil, e
	}
	for _, name := range []string{"fault-before.txt", "fault-after-query.txt"} {
		if _, e := load(filepath.Join(folder, name)); e == nil {
			r.RawEvidencePaths[strings.TrimSuffix(name, ".txt")] = name
		} else if !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
	}
	var status struct {
		Status  string `json:"status"`
		Warning string `json:"warning"`
	}
	if e = decode(filepath.Join(directory, "capture-status.json"), &status); e == nil {
		r.RawEvidencePaths["capture_status"] = "../capture-status.json"
		switch status.Status {
		case "complete":
			// Completed capture status does not override other evidence warnings.
		case "failed":
			r.warn("capture_failed", status.Warning, nil)
		default:
			r.warn("capture_unfinished", fmt.Sprintf("Capture status %q does not establish completion.", status.Status), nil)
		}
	} else if e != nil && !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	r.TimingAvailable = r.CaptureStatus == "complete"
	return r, nil
}

func readTopology(directory string, r *Recording) error {
	paths, e := filepath.Glob(filepath.Join(directory, "topology-*.json"))
	if e != nil {
		return e
	}
	aliases := map[string]bool{}
	for _, path := range paths {
		var tablet struct {
			Alias struct {
				Cell string      `json:"cell"`
				UID  json.Number `json:"uid"`
			} `json:"alias"`
			Keyspace *string `json:"keyspace"`
			Shard    *string `json:"shard"`
			Type     *string `json:"type"`
		}
		raw, e := load(path)
		if e != nil {
			return e
		}
		var wrapped map[string]json.RawMessage
		if e = json.Unmarshal(raw, &wrapped); e != nil {
			return e
		}
		if nested, ok := wrapped["tablet"]; ok {
			raw = nested
		}
		if e = json.Unmarshal(raw, &tablet); e != nil {
			return e
		}
		uid, e := strconv.ParseUint(string(tablet.Alias.UID), 10, 32)
		if e != nil {
			return fmt.Errorf("invalid tablet UID: %w", e)
		}
		alias := fmt.Sprintf("%s-%010d", tablet.Alias.Cell, uid)
		if aliases[alias] {
			return fmt.Errorf("ambiguous topology identity %s", alias)
		}
		aliases[alias] = true
		evidencePath := "../" + filepath.Base(path)
		r.TopologySnapshot.Tablets = append(r.TopologySnapshot.Tablets, Tablet{alias, tablet.Keyspace, tablet.Shard, tablet.Type, evidencePath})
		r.RawEvidencePaths["topology:"+alias] = evidencePath
	}
	shards := map[string]bool{}
	for _, tablet := range r.TopologySnapshot.Tablets {
		if tablet.Keyspace != nil && *tablet.Keyspace != "demo" {
			return fmt.Errorf("topology keyspace is outside the demo")
		}
		if tablet.Shard != nil {
			if *tablet.Shard != "-80" && *tablet.Shard != "80-" {
				return fmt.Errorf("topology shard is outside the demo")
			}
			shards[*tablet.Shard] = true
		}
	}
	if len(paths) != 2 || len(shards) != 2 {
		r.warn("missing_topology", "The two-shard topology snapshot is incomplete.", nil)
	}
	for _, item := range []struct {
		file   string
		target *json.RawMessage
	}{{"vschema.json", &r.TopologySnapshot.VSchema}, {"shards.json", &r.TopologySnapshot.Shards}} {
		raw, e := load(filepath.Join(directory, item.file))
		if e == nil {
			if !json.Valid(raw) {
				return fmt.Errorf("invalid topology JSON %s", item.file)
			}
			*item.target = raw
			r.RawEvidencePaths[item.file] = "../" + item.file
		} else if !errors.Is(e, os.ErrNotExist) {
			return e
		}
	}
	// A clock/layout claim needs explicit captured metadata; old evidence leaves it unknown.
	var environment struct {
		Layout      *string `json:"layout"`
		Uncertainty *int64  `json:"clock_uncertainty_us"`
	}
	if e = decode(filepath.Join(directory, "environment.json"), &environment); e == nil {
		r.TopologySnapshot.Layout = environment.Layout
		r.ClockUncertaintyUS = environment.Uncertainty
		r.RawEvidencePaths["environment"] = "../environment.json"
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	return nil
}
func readResult(folder string, r *Recording) error {
	raw, e := load(filepath.Join(folder, "result.tsv"))
	if errors.Is(e, os.ErrNotExist) {
		r.warn("missing_result", "Query result is unavailable.", nil)
		return nil
	}
	if e != nil {
		return e
	}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	result := &QueryResult{Columns: strings.Split(lines[0], "\t"), Rows: [][]string{}, EvidencePath: "result.tsv"}
	for _, line := range lines[1:] {
		row := strings.Split(line, "\t")
		if len(row) != len(result.Columns) {
			return fmt.Errorf("query result column count mismatch")
		}
		result.Rows = append(result.Rows, row)
	}
	expected := "20"
	if r.ExperimentID == "one-shard" {
		expected = "2"
	}
	if len(result.Columns) != 1 || len(result.Rows) != 1 || result.Rows[0][0] != expected {
		return fmt.Errorf("result does not match the seeded experiment")
	}
	r.QueryResult = result
	r.RawEvidencePaths["result"] = "result.tsv"
	return nil
}
func readExplain(folder string, r *Recording) error {
	ids := map[string]bool{}
	if r.RunID != nil {
		ids[*r.RunID] = true
	}
	for _, format := range []string{"PLAN", "QUERIES", "TRACE"} {
		name := "vexplain-" + strings.ToLower(format)
		var meta struct {
			ID       *string `json:"run_id"`
			Ordinary *string `json:"ordinary_run_id"`
			Format   string  `json:"format"`
			SQL      *string `json:"sql"`
			Separate bool    `json:"separate_execution"`
		}
		e := decode(filepath.Join(folder, name+".json"), &meta)
		if errors.Is(e, os.ErrNotExist) {
			r.warn("missing_explain", "Separate VEXPLAIN "+format+" evidence is unavailable.", nil)
			continue
		}
		if e != nil {
			return e
		}
		if meta.ID == nil || *meta.ID == "" || ids[*meta.ID] || !meta.Separate || meta.Format != format || r.RunID == nil || meta.Ordinary == nil || *meta.Ordinary != *r.RunID || meta.SQL == nil || r.QueryTemplate == nil || *meta.SQL != *r.QueryTemplate {
			return fmt.Errorf("VEXPLAIN %s is not a separate matching execution", format)
		}
		ids[*meta.ID] = true
		output, e := load(filepath.Join(folder, name+".tsv"))
		if errors.Is(e, os.ErrNotExist) {
			r.warn("missing_explain_output", "VEXPLAIN "+format+" output is unavailable.", nil)
			continue
		}
		if e != nil {
			return e
		}
		r.ExplainRuns = append(r.ExplainRuns, ExplainRun{meta.ID, format, ptr(string(output)), true, name + ".tsv"})
		r.RawEvidencePaths[name] = name + ".tsv"
		r.RawEvidencePaths[name+"_execution"] = name + ".json"
	}
	return nil
}

type traceSpan struct {
	ID         string  `json:"spanID"`
	TraceID    string  `json:"traceID"`
	Operation  *string `json:"operationName"`
	ProcessID  *string `json:"processID"`
	Start      *int64  `json:"startTime"`
	Duration   *int64  `json:"duration"`
	References []struct {
		Type    string `json:"refType"`
		TraceID string `json:"traceID"`
		SpanID  string `json:"spanID"`
	} `json:"references"`
	Tags []struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	} `json:"tags"`
	Warnings []string `json:"warnings"`
}
type traceProcess struct {
	Service *string `json:"serviceName"`
	Tags    []struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	} `json:"tags"`
}

func normalizeTrace(raw []byte, r *Recording, start, end *int64) error {
	var response struct {
		Data []struct {
			ID        string                  `json:"traceID"`
			Spans     []traceSpan             `json:"spans"`
			Processes map[string]traceProcess `json:"processes"`
			Warnings  []string                `json:"warnings"`
		} `json:"data"`
		Errors json.RawMessage `json:"errors"`
	}
	if e := json.Unmarshal(raw, &response); e != nil {
		return e
	}
	if len(response.Data) > 1 {
		return fmt.Errorf("ambiguous capture: multiple query traces")
	}
	if len(response.Data) == 0 {
		r.warn("missing_trace", "No query trace was exported; missing branches are not proof of absence.", nil)
		return nil
	}
	if len(response.Errors) > 0 && string(response.Errors) != "null" && string(response.Errors) != "[]" {
		r.warn("trace_export_errors", string(response.Errors), nil)
	}
	trace := response.Data[0]
	if trace.ID == "" {
		return fmt.Errorf("trace ID missing")
	}
	r.TraceID = ptr(trace.ID)
	for _, warning := range trace.Warnings {
		r.warn("trace_warning", warning, nil)
	}
	rawByID := map[string]traceSpan{}
	byID := map[string]*Span{}
	roots := []string{}
	for index, s := range trace.Spans {
		if s.ID == "" {
			return fmt.Errorf("span ID missing")
		}
		if _, exists := rawByID[s.ID]; exists {
			return fmt.Errorf("duplicate span ID %s", s.ID)
		}
		if s.TraceID != "" && s.TraceID != trace.ID {
			return fmt.Errorf("span belongs to another trace")
		}
		rawByID[s.ID] = s
		normalized := Span{ID: s.ID, Operation: s.Operation, Start: s.Start, DurationUS: s.Duration, Attributes: map[string]any{}, References: []Reference{}, EvidencePath: "jaeger.json", EvidencePointer: fmt.Sprintf("/data/0/spans/%d", index)}
		if s.ProcessID != nil {
			if process, ok := trace.Processes[*s.ProcessID]; ok {
				normalized.Service = process.Service
			} else {
				r.warn("missing_process", "Span service identity is unavailable.", ptr(s.ID))
			}
		}
		for _, tag := range s.Tags {
			if old, ok := normalized.Attributes[tag.Key]; ok && !reflect.DeepEqual(old, tag.Value) {
				return fmt.Errorf("conflicting span attribute %s", tag.Key)
			}
			normalized.Attributes[tag.Key] = tag.Value
		}
		if normalized.Service == nil || normalized.Operation == nil {
			r.warn("unknown_span_identity", "Span service or operation is unavailable.", ptr(s.ID))
		}
		if status, ok := normalized.Attributes["otel.status_code"].(string); ok && status != "UNSET" {
			normalized.Status = ptr(strings.ToLower(status))
		}
		if normalized.Attributes["error"] == true {
			normalized.Status = ptr("error")
		}
		if normalized.Status != nil && *normalized.Status == "error" {
			r.warn("span_error", "Operation reported an error.", ptr(s.ID))
		}
		if s.Start != nil && s.Duration != nil {
			if *s.Duration < 0 || *s.Start > math.MaxInt64-*s.Duration {
				return fmt.Errorf("invalid span duration %s", s.ID)
			}
			normalized.End = ptr(*s.Start + *s.Duration)
		} else {
			r.warn("missing_span_timing", "A span has no measured start or duration.", ptr(s.ID))
		}
		parents := 0
		for _, ref := range s.References {
			normalized.References = append(normalized.References, Reference{ref.Type, ref.TraceID, ref.SpanID})
			if ref.Type == "CHILD_OF" {
				parents++
				normalized.ParentID = ptr(ref.SpanID)
			}
		}
		if parents > 1 {
			return fmt.Errorf("ambiguous parent identity %s", s.ID)
		}
		if parents == 0 {
			roots = append(roots, s.ID)
		}
		for _, warning := range s.Warnings {
			r.warn("span_warning", warning, ptr(s.ID))
		}
		r.Spans = append(r.Spans, normalized)
	}
	for index := range r.Spans {
		byID[r.Spans[index].ID] = &r.Spans[index]
	}
	completeRoot := ""
	for _, id := range roots {
		span := byID[id]
		if span.Operation != nil && *span.Operation == "vtgateHandler.ComQuery" && span.Service != nil && *span.Service == "vtgate" {
			if completeRoot != "" {
				return fmt.Errorf("ambiguous query roots")
			}
			completeRoot = id
		}
	}
	if completeRoot == "" {
		r.warn("missing_root", "The gateway query root is unavailable.", nil)
	} else {
		r.RootSpanID = ptr(completeRoot)
		root := byID[completeRoot]
		if start == nil || end == nil || root.Start == nil || root.End == nil {
			r.warn("uncorrelated_root", "Root timing cannot be matched to the query interval.", ptr(root.ID))
		} else if *root.Start < *start || *root.Start > *end || *root.End > *end+1000 {
			return fmt.Errorf("root trace does not match the ordinary query interval")
		}
	}
	if len(roots) != 1 {
		r.warn("disconnected_trace", "The trace contains missing or disconnected parents.", nil)
	}
	for _, span := range r.Spans {
		for _, ref := range span.References {
			if ref.TraceID != trace.ID {
				return fmt.Errorf("cross-trace parent reference")
			}
			if parent, ok := byID[ref.SpanID]; ok {
				if ref.Type == "CHILD_OF" && span.Start != nil && span.End != nil && parent.Start != nil && parent.End != nil && (*span.Start < *parent.Start-1000 || *span.End > *parent.End+1000) {
					r.warn("clock_order_uncertain", "Original timestamps disagree with parent ordering; no alignment was applied.", ptr(span.ID))
				}
			} else {
				r.warn("missing_parent", "Referenced parent was not exported.", ptr(span.ID))
			}
		}
		seen := map[string]bool{}
		cursor := &span
		for cursor != nil {
			if seen[cursor.ID] {
				return fmt.Errorf("cyclic span ancestry")
			}
			seen[cursor.ID] = true
			if cursor.ParentID == nil {
				break
			}
			cursor = byID[*cursor.ParentID]
		}
	}
	tablets := map[string]Tablet{}
	for _, tablet := range r.TopologySnapshot.Tablets {
		tablets[tablet.Alias] = tablet
	}
	branchByRPC := map[string]int{}
	for _, s := range r.Spans {
		if s.Service == nil || *s.Service != "vttablet" || s.Operation == nil || (*s.Operation != "TabletServer.Execute" && *s.Operation != "TabletServer.StreamExecute") {
			continue
		}
		shard, ok := s.Attributes["shard"].(string)
		if !ok {
			continue
		} // Outer wrappers have no shard attributes.
		rawSpan := rawByID[s.ID]
		alias := ""
		if rawSpan.ProcessID != nil {
			for _, tag := range trace.Processes[*rawSpan.ProcessID].Tags {
				if tag.Key == "service.instance.id" {
					value, valid := tag.Value.(string)
					if !valid || (alias != "" && alias != value) {
						return fmt.Errorf("ambiguous tablet resource identity")
					}
					alias = value
				}
			}
		}
		tablet, known := tablets[alias]
		if !known || tablet.Shard == nil || tablet.Keyspace == nil {
			r.warn("unknown_branch_identity", "Traced tablet cannot be mapped to captured topology.", ptr(s.ID))
			continue
		}
		if *tablet.Shard != shard || s.Attributes["keyspace"] != *tablet.Keyspace {
			return fmt.Errorf("tablet identity conflicts with captured topology")
		}
		support := []string{s.ID}
		cursor := &s
		var rpc *Span
		for cursor.ParentID != nil {
			parent := byID[*cursor.ParentID]
			if parent == nil {
				break
			}
			support = append(support, parent.ID)
			if parent.Service != nil && *parent.Service == "vtgate" && parent.Attributes["span.kind"] == "client" && rpc == nil {
				rpc = parent
			}
			cursor = parent
		}
		if rpc == nil {
			r.warn("missing_rpc", "No measured gateway RPC supports this tablet branch.", ptr(s.ID))
			continue
		}
		if existing, ok := branchByRPC[rpc.ID]; ok {
			branch := &r.Branches[existing]
			if branch.Tablet != alias || branch.Shard != shard {
				return fmt.Errorf("ambiguous RPC tablet identity")
			}
			branch.SupportingSpanIDs = unique(append(branch.SupportingSpanIDs, support...))
			continue
		}
		branchByRPC[rpc.ID] = len(r.Branches)
		r.Branches = append(r.Branches, Branch{shard, alias, rpc.ID, unique(support), "service.instance.id + span keyspace/shard + captured topology", tablet.EvidencePath, rpc.Start, rpc.End, rpc.DurationUS})
	}
	touched := map[string]bool{}
	for _, branch := range r.Branches {
		touched[branch.Shard] = true
	}
	expected := 2
	if r.ExperimentID == "one-shard" {
		expected = 1
	}
	if len(touched) != expected {
		r.warn("missing_branches", fmt.Sprintf("Expected %d shard identities, observed %d; absent branches cannot prove that those shards did not execute.", expected, len(touched)), nil)
	}
	// VEXPLAIN is a separate execution. Compare routes, never merge its operators or timings.
	for _, explain := range r.ExplainRuns {
		if explain.Format != "QUERIES" || explain.RawOutput == nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(*explain.RawOutput), "\n")
		routes := map[string]bool{}
		for _, line := range lines[1:] {
			cols := strings.Split(line, "\t")
			if len(cols) < 4 {
				return fmt.Errorf("invalid VEXPLAIN QUERIES output")
			}
			routes[cols[2]] = true
		}
		for shard := range touched {
			if !routes[shard] {
				return fmt.Errorf("observed route conflicts with separate VEXPLAIN execution")
			}
		}
		if len(routes) != len(touched) {
			r.warn("route_evidence_incomplete", "Trace and separate VEXPLAIN execution expose different branch counts.", nil)
		}
	}
	sort.Slice(r.Spans, func(i, j int) bool {
		a, b := r.Spans[i], r.Spans[j]
		if a.Start != nil && b.Start != nil && *a.Start != *b.Start {
			return *a.Start < *b.Start
		}
		return a.ID < b.ID
	})
	sort.Slice(r.Branches, func(i, j int) bool {
		a, b := r.Branches[i], r.Branches[j]
		if a.Shard != b.Shard {
			return a.Shard < b.Shard
		}
		return a.RPCSpanID < b.RPCSpanID
	})
	return nil
}
func unique(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// ExportDirectory validates every existing experiment before replacing any recordings.
func ExportDirectory(directory string) ([]string, error) {
	type output struct {
		path string
		data []byte
	}
	outputs := []output{}
	for _, experiment := range experiments {
		folder := filepath.Join(directory, experiment)
		info, e := os.Stat(folder)
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return nil, e
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("experiment path is not a directory")
		}
		r, e := Normalize(directory, experiment)
		if e != nil {
			return nil, fmt.Errorf("%s: %w", experiment, e)
		}
		data, e := json.MarshalIndent(r, "", "  ")
		if e != nil {
			return nil, e
		}
		outputs = append(outputs, output{filepath.Join(folder, "recording.json"), append(data, '\n')})
	}
	if len(outputs) == 0 {
		return nil, fmt.Errorf("no experiment evidence directories found")
	}
	paths := []string{}
	for _, output := range outputs {
		temporary, e := os.CreateTemp(filepath.Dir(output.path), ".recording-*")
		if e != nil {
			return nil, e
		}
		name := temporary.Name()
		_, e = temporary.Write(output.data)
		e = errors.Join(e, temporary.Close())
		if e == nil {
			e = os.Rename(name, output.path)
		}
		if e != nil {
			os.Remove(name)
			return nil, e
		}
		paths = append(paths, output.path)
	}
	return paths, nil
}
