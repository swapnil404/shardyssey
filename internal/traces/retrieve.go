// Package traces retrieves bounded raw Jaeger captures without discarding source fields.
package traces

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxEvidence = 32 << 20

// Only correlation fields are decoded; the full response remains raw JSON.
type Reference struct {
	Type    string `json:"refType"`
	TraceID string `json:"traceID"`
	SpanID  string `json:"spanID"`
}
type Span struct {
	ID         string      `json:"spanID"`
	Operation  string      `json:"operationName"`
	Start      int64       `json:"startTime"`
	Duration   int64       `json:"duration"`
	References []Reference `json:"references"`
}
type Trace struct {
	ID    string `json:"traceID"`
	Spans []Span `json:"spans"`
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
	var latest []byte
	params := url.Values{"service": {"vtgate"}, "start": {strconv.FormatInt(start, 10)}, "end": {strconv.FormatInt(end, 10)}, "limit": {"100"}}
	for {
		request, e := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint, "/")+"/api/traces?"+params.Encode(), nil)
		if e != nil {
			return nil, e
		}
		response, e := client.Do(request)
		if e != nil {
			return latest, fmt.Errorf("trace retrieval failed: %w", e)
		}
		body, e := io.ReadAll(io.LimitReader(response.Body, maxEvidence+1))
		response.Body.Close()
		if e != nil {
			return latest, fmt.Errorf("trace response read failed: %w", e)
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
			raw.Data = candidates
			latest, e = json.MarshalIndent(raw, "", "  ")
			if e != nil {
				return nil, e
			}
			latest = append(latest, '\n')
			current := fingerprint(candidate)
			if current == previous {
				return latest, nil
			}
			previous = current
		} else {
			previous = ""
		}
		select {
		case <-ctx.Done():
			return latest, fmt.Errorf("trace export did not stabilize: %w", ctx.Err())
		case <-time.After(time.Second):
		}
	}
}
