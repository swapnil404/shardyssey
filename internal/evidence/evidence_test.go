package evidence

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func copyFixture(t *testing.T) string {
	t.Helper()
	source := "../../fixtures/20261002T145252Z"
	target := t.TempDir()
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0755)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, b, 0644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return target
}
func TestMeasuredEvidence(t *testing.T) {
	paths, err := filepath.Glob("../../fixtures/*/gate-report.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("missing real fixtures")
	}
	for _, path := range paths {
		t.Run(filepath.Base(filepath.Dir(path)), func(t *testing.T) {
			if _, err := Audit(filepath.Dir(path)); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestRejectUnreliableEvidence(t *testing.T) {
	for _, kind := range []string{"missing-parent", "wrong-tablet", "missing-branch", "duplicate-span", "cycle"} {
		t.Run(kind, func(t *testing.T) {
			directory := copyFixture(t)
			path := filepath.Join(directory, "fan-out/jaeger.json")
			var response Response
			if err := readJSON(path, &response); err != nil {
				t.Fatal(err)
			}
			trace := &response.Data[0]
			switch kind {
			case "missing-parent":
				for i := range trace.Spans {
					if len(trace.Spans[i].References) > 0 {
						trace.Spans[i].References[0].SpanID = "missing"
						break
					}
				}
			case "wrong-tablet":
				for id, p := range trace.Processes {
					if p.Service == "vttablet" {
						for i := range p.Tags {
							if p.Tags[i].Key == "service.instance.id" {
								p.Tags[i].Value = "unknown"
							}
						}
						trace.Processes[id] = p
						break
					}
				}
			case "missing-branch":
				filtered := []Span{}
				for _, s := range trace.Spans {
					if attr(s.Tags, "shard") != "80-" {
						filtered = append(filtered, s)
					}
				}
				trace.Spans = filtered
			case "duplicate-span":
				trace.Spans = append(trace.Spans, trace.Spans[0])
			case "cycle":
				for i := range trace.Spans {
					if len(trace.Spans[i].References) > 0 {
						trace.Spans[i].References[0].SpanID = trace.Spans[i].ID
						break
					}
				}
			}
			if err := saveJSON(path, response); err != nil {
				t.Fatal(err)
			}
			if _, err := Audit(directory); err == nil {
				t.Fatal("unreliable evidence accepted")
			}
		})
	}
}
func TestRetrieveRejectsAmbiguousCorrelation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trace := Trace{ID: "trace", Spans: []Span{{ID: "executor", Operation: "executor.Execute", Start: 100}}}
		json.NewEncoder(w).Encode(Response{Data: []Trace{trace, trace}})
	}))
	defer server.Close()
	if _, err := Retrieve(context.Background(), server.URL, 90, 110); err == nil || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("expected ambiguous correlation error, got %v", err)
	}
}
func TestRetrievePreservesRawEvidence(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := calls.Add(1)
		a := `{"spanID":"a","operationName":"executor.Execute","startTime":100,"duration":5,"unrecognized":"keep"}`
		b := `{"spanID":"b","operationName":"RPC","startTime":101,"duration":2}`
		spans := a + "," + b
		if count%2 == 0 {
			spans = b + "," + a
		}
		w.Write([]byte(`{"data":[{"traceID":"trace","extra":"keep","spans":[` + spans + `]}],"errors":null}`))
	}))
	defer server.Close()
	raw, err := Retrieve(context.Background(), server.URL, 90, 110)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"unrecognized": "keep"`) || !strings.Contains(string(raw), `"extra": "keep"`) {
		t.Fatal("raw fields lost")
	}
	if calls.Load() != 2 {
		t.Fatalf("unstable span ordering: %d requests", calls.Load())
	}
}
func TestCleanupAfterCancellation(t *testing.T) {
	root := t.TempDir()
	demo := filepath.Join(root, "demo")
	if err := os.Mkdir(demo, 0755); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\ncase \"$1\" in\non) touch \"" + filepath.Join(root, "delay") + "\";;\noff) rm -f \"" + filepath.Join(root, "delay") + "\";;\nstatus) echo noqueue;;\nesac\n"
	if err := os.WriteFile(filepath.Join(demo, "fault.sh"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := (Capturer{Root: root}).experiment(ctx, filepath.Join(root, "run"), "cancelled", "SELECT COUNT(*) FROM events", true); err == nil {
		t.Fatal("expected cancellation")
	}
	if _, err := os.Stat(filepath.Join(root, "run/fault-cleanup.txt")); err != nil {
		t.Fatalf("cleanup did not run independently of cancelled context: %v", err)
	}
}

func TestCleanupAfterFaultInstalled(t *testing.T) {
	for _, scenario := range []string{"query-failure", "fault-failure", "cancellation"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			demo := filepath.Join(root, "demo")
			if err := os.Mkdir(demo, 0755); err != nil {
				t.Fatal(err)
			}
			marker := filepath.Join(root, "delay")
			installed := make(chan struct{})
			script := "#!/bin/sh\ncase \"$1\" in\non) echo \"$2\" > '" + filepath.Join(root, "argument") + "'; cp '" + filepath.Join(root, "argument") + "' '" + marker + "'"
			if scenario == "fault-failure" {
				script += "; exit 1"
			}
			if scenario == "cancellation" {
				script += "; sleep 10"
			}
			script += ";;\noff) rm -f '" + marker + "';;\nstatus) echo noqueue;;\nesac\n"
			if err := os.WriteFile(filepath.Join(demo, "fault.sh"), []byte(script), 0755); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if scenario == "cancellation" {
				go func() {
					defer close(installed)
					for {
						if _, err := os.Stat(marker); err == nil {
							cancel()
							return
						}
						select {
						case <-ctx.Done():
							return
						case <-time.After(time.Millisecond):
						}
					}
				}()
			}
			err := (Capturer{Root: root, DelayMS: 300, DSN: "invalid"}).experiment(ctx, filepath.Join(root, "run"), "slow-branch", "SELECT COUNT(*) FROM events", true)
			if scenario == "cancellation" {
				<-installed
			}
			if err == nil {
				t.Fatal("expected capture failure")
			}
			argument, readErr := os.ReadFile(filepath.Join(root, "argument"))
			if readErr != nil || strings.TrimSpace(string(argument)) != "300" {
				t.Fatalf("fault was not installed with selected delay: %q %v", argument, readErr)
			}
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatalf("fault left installed: %v", err)
			}
			if _, err := os.Stat(filepath.Join(root, "run", "fault-cleanup.txt")); err != nil {
				t.Fatalf("missing cleanup evidence: %v", err)
			}
		})
	}
}

func TestRejectInvalidFaultEvidence(t *testing.T) {
	for _, fault := range []map[string]any{
		{"type": "database slowness", "shard": "80-", "delay_ms": 500},
		{"type": "injected network delay", "shard": "-80", "delay_ms": 500},
		{"type": "injected network delay", "shard": "80-", "delay_ms": 99},
		{"type": "injected network delay", "shard": "80-", "delay_ms": 1001},
	} {
		directory := copyFixture(t)
		path := filepath.Join(directory, "slow-branch", "execution.json")
		var execution Execution
		if err := readJSON(path, &execution); err != nil {
			t.Fatal(err)
		}
		execution.Fault = fault
		if err := saveJSON(path, execution); err != nil {
			t.Fatal(err)
		}
		if _, err := Audit(directory); err == nil {
			t.Fatalf("accepted fault %#v", fault)
		}
	}
}
