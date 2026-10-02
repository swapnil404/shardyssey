// Package recording defines and builds evidence-backed query recordings.
package recording

import "encoding/json"

const SchemaVersion = 1

// Times use the original Unix microseconds from Jaeger. Nil means unmeasured.
type Span struct {
	ID              string         `json:"id"`
	ParentID        *string        `json:"parent_id"`
	Service         *string        `json:"service"`
	Operation       *string        `json:"operation"`
	Start           *int64         `json:"start"`
	End             *int64         `json:"end"`
	DurationUS      *int64         `json:"duration_us"`
	Status          *string        `json:"status"`
	Attributes      map[string]any `json:"attributes"`
	References      []Reference    `json:"references"`
	EvidencePath    string         `json:"evidence_path"`
	EvidencePointer string         `json:"evidence_pointer"`
}
type Reference struct {
	Type    string `json:"type"`
	TraceID string `json:"trace_id"`
	SpanID  string `json:"span_id"`
}
type Tablet struct {
	Alias        string  `json:"alias"`
	Keyspace     *string `json:"keyspace"`
	Shard        *string `json:"shard"`
	Type         *string `json:"type"`
	EvidencePath string  `json:"evidence_path"`
}
type Topology struct {
	Tablets []Tablet        `json:"tablets"`
	VSchema json.RawMessage `json:"vschema"`
	Shards  json.RawMessage `json:"shards"`
	Layout  *string         `json:"layout"`
}
type Branch struct {
	Shard                string   `json:"shard"`
	Tablet               string   `json:"tablet"`
	RPCSpanID            string   `json:"rpc_span_id"`
	SupportingSpanIDs    []string `json:"supporting_span_ids"`
	IdentitySource       string   `json:"identity_source"`
	TopologyEvidencePath string   `json:"topology_evidence_path"`
	Start                *int64   `json:"start"`
	End                  *int64   `json:"end"`
	DurationUS           *int64   `json:"duration_us"`
}
type ExplainRun struct {
	RunID             *string `json:"run_id"`
	Format            string  `json:"format"`
	RawOutput         *string `json:"raw_output"`
	SeparateExecution bool    `json:"separate_execution"`
	EvidencePath      string  `json:"evidence_path"`
}
type QueryResult struct {
	Columns      []string   `json:"columns"`
	Rows         [][]string `json:"rows"`
	EvidencePath string     `json:"evidence_path"`
}
type Warning struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	SpanID  *string `json:"span_id"`
}
type Recording struct {
	SchemaVersion      int               `json:"schema_version"`
	RunID              *string           `json:"run_id"`
	ExperimentID       string            `json:"experiment_id"`
	VitessVersion      *string           `json:"vitess_version"`
	TopologySnapshot   Topology          `json:"topology_snapshot"`
	QueryTemplate      *string           `json:"query_template"`
	Parameters         map[string]any    `json:"parameters"`
	FaultConfiguration json.RawMessage   `json:"fault_configuration"`
	ClientElapsedMS    *float64          `json:"client_elapsed_ms"`
	QueryResult        *QueryResult      `json:"query_result"`
	TraceID            *string           `json:"trace_id"`
	CaptureStatus      string            `json:"capture_status"`
	RawEvidencePaths   map[string]string `json:"raw_evidence_paths"`
	Spans              []Span            `json:"spans"`
	Branches           []Branch          `json:"branches"`
	ExplainRuns        []ExplainRun      `json:"explain_runs"`
	Warnings           []Warning         `json:"warnings"`
	RootSpanID         *string           `json:"root_span_id"`
	TimingAvailable    bool              `json:"timing_available"`
	TimestampUnit      string            `json:"timestamp_unit"`
	ClockUncertaintyUS *int64            `json:"clock_uncertainty_us"`
}
