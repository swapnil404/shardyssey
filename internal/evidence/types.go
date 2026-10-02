package evidence

import (
	"encoding/json"
	"fmt"
	"os"
)

type Tag struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}
type Reference struct {
	Type    string `json:"refType"`
	TraceID string `json:"traceID"`
	SpanID  string `json:"spanID"`
}
type Span struct {
	ID         string      `json:"spanID"`
	TraceID    string      `json:"traceID"`
	Operation  string      `json:"operationName"`
	References []Reference `json:"references"`
	Start      int64       `json:"startTime"`
	Duration   int64       `json:"duration"`
	Tags       []Tag       `json:"tags"`
	ProcessID  string      `json:"processID"`
	Warnings   []string    `json:"warnings"`
}
type Process struct {
	Service string `json:"serviceName"`
	Tags    []Tag  `json:"tags"`
}
type Trace struct {
	ID        string             `json:"traceID"`
	Spans     []Span             `json:"spans"`
	Processes map[string]Process `json:"processes"`
}
type Response struct {
	Data   []Trace         `json:"data"`
	Errors json.RawMessage `json:"errors"`
}
type Execution struct {
	RunID       string  `json:"run_id"`
	Experiment  string  `json:"experiment_id"`
	SQL         string  `json:"sql"`
	Start       int64   `json:"start_unix_us"`
	End         int64   `json:"end_unix_us"`
	Elapsed     float64 `json:"client_elapsed_ms"`
	Scope       string  `json:"elapsed_scope"`
	Fault       any     `json:"fault_configuration"`
	Correlation string  `json:"correlation"`
}
type Branch struct {
	Shard          string  `json:"shard"`
	Tablet         string  `json:"tablet"`
	TabletSpan     string  `json:"tablet_span_id"`
	RPCSpan        string  `json:"rpc_span_id"`
	Start          int64   `json:"rpc_start_unix_us"`
	RPCDuration    float64 `json:"rpc_duration_ms"`
	TabletDuration float64 `json:"tablet_duration_ms"`
	Identity       string  `json:"identity_source"`
}
type ExperimentReport struct {
	RunID    string   `json:"run_id"`
	TraceID  string   `json:"trace_id"`
	RootID   string   `json:"root_span_id"`
	Duration float64  `json:"root_duration_ms"`
	Elapsed  float64  `json:"client_elapsed_ms"`
	Branches []Branch `json:"branches"`
}
type Report struct {
	Gate        string                      `json:"gate"`
	Layout      string                      `json:"layout"`
	Clock       string                      `json:"clock"`
	Experiments map[string]ExperimentReport `json:"experiments"`
	Delay       map[string]float64          `json:"delay_effect_ms"`
}

func attr(tags []Tag, key string) any {
	for _, t := range tags {
		if t.Key == key {
			return t.Value
		}
	}
	return nil
}
func readJSON(path string, value any) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, value); e != nil {
		return fmt.Errorf("%s: %w", path, e)
	}
	return nil
}
func saveJSON(path string, value any) error {
	b, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return e
	}
	return os.WriteFile(path, append(b, '\n'), 0644)
}
