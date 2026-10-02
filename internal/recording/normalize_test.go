package recording

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const fixture = "../../fixtures/20261002T150508Z"

func fixtureCopy(t *testing.T) string {
	t.Helper()
	target := t.TempDir()
	e := filepath.WalkDir(fixture, func(path string, entry os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		relative, e := filepath.Rel(fixture, path)
		if e != nil {
			return e
		}
		dest := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(dest, 0755)
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		return os.WriteFile(dest, data, 0644)
	})
	if e != nil {
		t.Fatal(e)
	}
	return target
}
func mutateTrace(t *testing.T, directory string, mutate func(map[string]any)) {
	t.Helper()
	path := filepath.Join(directory, "fan-out/jaeger.json")
	var raw map[string]any
	if e := decode(path, &raw); e != nil {
		t.Fatal(e)
	}
	mutate(raw)
	b, e := json.Marshal(raw)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(path, b, 0644); e != nil {
		t.Fatal(e)
	}
}
func rawTrace(raw map[string]any) map[string]any { return raw["data"].([]any)[0].(map[string]any) }
func hasWarning(r *Recording, code string) bool {
	for _, warning := range r.Warnings {
		if warning.Code == code {
			return true
		}
	}
	return false
}
func TestMeasuredRecordings(t *testing.T) {
	for _, experiment := range experiments {
		t.Run(experiment, func(t *testing.T) {
			r, e := Normalize(fixture, experiment)
			if e != nil {
				t.Fatal(e)
			}
			if r.CaptureStatus != "complete" || !r.TimingAvailable || len(r.Warnings) != 0 {
				t.Fatalf("unexpected incomplete recording: %+v", r.Warnings)
			}
			expected := 2
			if experiment == "one-shard" {
				expected = 1
			}
			if len(r.Branches) != expected {
				t.Fatal("wrong routing")
			}
			var response struct {
				Data []struct {
					Spans []traceSpan `json:"spans"`
				} `json:"data"`
			}
			if e = decode(filepath.Join(fixture, experiment, "jaeger.json"), &response); e != nil {
				t.Fatal(e)
			}
			original := map[string]traceSpan{}
			for _, s := range response.Data[0].Spans {
				original[s.ID] = s
			}
			if len(r.Spans) != len(original) {
				t.Fatal("spans discarded")
			}
			for _, s := range r.Spans {
				raw := original[s.ID]
				if !reflect.DeepEqual(s.Start, raw.Start) || !reflect.DeepEqual(s.DurationUS, raw.Duration) || *s.End != *raw.Start+*raw.Duration {
					t.Fatal("source timing changed")
				}
				if _, e = os.Stat(filepath.Join(fixture, experiment, s.EvidencePath)); e != nil {
					t.Fatal(e)
				}
			}
			for _, branch := range r.Branches {
				if len(branch.SupportingSpanIDs) < 3 {
					t.Fatal("branch lacks supporting ancestry")
				}
				for _, id := range branch.SupportingSpanIDs {
					if _, ok := original[id]; !ok {
						t.Fatal("invented support ID")
					}
				}
				if _, e = os.Stat(filepath.Join(fixture, experiment, branch.TopologyEvidencePath)); e != nil {
					t.Fatal(e)
				}
			}
			for _, explain := range r.ExplainRuns {
				if *explain.RunID == *r.RunID || !explain.SeparateExecution {
					t.Fatal("explain merged with ordinary execution")
				}
			}
			for _, path := range r.RawEvidencePaths {
				if _, e = os.Stat(filepath.Join(fixture, experiment, path)); e != nil {
					t.Fatal(e)
				}
			}
		})
	}
}
func TestIncompleteEvidence(t *testing.T) {
	for _, kind := range []string{"missing-parent", "missing-branch", "unknown-timing", "missing-trace", "unknown-tablet"} {
		t.Run(kind, func(t *testing.T) {
			directory := fixtureCopy(t)
			if kind == "missing-trace" {
				if e := os.Remove(filepath.Join(directory, "fan-out/jaeger.json")); e != nil {
					t.Fatal(e)
				}
			} else {
				mutateTrace(t, directory, func(raw map[string]any) {
					trace := rawTrace(raw)
					spans := trace["spans"].([]any)
					switch kind {
					case "missing-parent":
						for _, item := range spans {
							s := item.(map[string]any)
							refs := s["references"].([]any)
							if len(refs) > 0 {
								refs[0].(map[string]any)["spanID"] = "not-exported"
								break
							}
						}
					case "missing-branch":
						filtered := []any{}
						for _, item := range spans {
							s := item.(map[string]any)
							remove := false
							for _, tag := range s["tags"].([]any) {
								v := tag.(map[string]any)
								if v["key"] == "shard" && v["value"] == "80-" {
									remove = true
								}
							}
							if !remove {
								filtered = append(filtered, item)
							}
						}
						trace["spans"] = filtered
					case "unknown-timing":
						delete(spans[0].(map[string]any), "startTime")
						delete(spans[0].(map[string]any), "duration")
					case "unknown-tablet":
						for _, process := range trace["processes"].(map[string]any) {
							p := process.(map[string]any)
							if p["serviceName"] == "vttablet" {
								for _, tag := range p["tags"].([]any) {
									v := tag.(map[string]any)
									if v["key"] == "service.instance.id" {
										v["value"] = "unknown"
									}
								}
								break
							}
						}
					}
				})
			}
			r, e := Normalize(directory, "fan-out")
			if e != nil {
				t.Fatal(e)
			}
			if r.CaptureStatus != "incomplete" || r.TimingAvailable || len(r.Warnings) == 0 {
				t.Fatal("missing evidence reported complete")
			}
			if kind == "unknown-timing" {
				found := false
				for _, s := range r.Spans {
					if s.Start == nil {
						found = true
						if s.End != nil || s.DurationUS != nil {
							t.Fatal("unknown timing fabricated")
						}
						b, _ := json.Marshal(s)
						if !strings.Contains(string(b), `"start":null`) {
							t.Fatal("unknown timing omitted")
						}
					}
				}
				if !found {
					t.Fatal("unknown span lost")
				}
			}
		})
	}
}
func TestRejectAmbiguousEvidence(t *testing.T) {
	for _, kind := range []string{"multiple-traces", "duplicate-span", "conflicting-topology", "cycle", "shared-explain-id"} {
		t.Run(kind, func(t *testing.T) {
			directory := fixtureCopy(t)
			if kind == "shared-explain-id" {
				var meta map[string]any
				path := filepath.Join(directory, "fan-out/vexplain-plan.json")
				decode(path, &meta)
				var execution map[string]any
				decode(filepath.Join(directory, "fan-out/execution.json"), &execution)
				meta["run_id"] = execution["run_id"]
				b, _ := json.Marshal(meta)
				os.WriteFile(path, b, 0644)
			} else {
				mutateTrace(t, directory, func(raw map[string]any) {
					trace := rawTrace(raw)
					spans := trace["spans"].([]any)
					switch kind {
					case "multiple-traces":
						raw["data"] = append(raw["data"].([]any), trace)
					case "duplicate-span":
						trace["spans"] = append(spans, spans[0])
					case "conflicting-topology":
						for _, item := range spans {
							for _, tag := range item.(map[string]any)["tags"].([]any) {
								v := tag.(map[string]any)
								if v["key"] == "shard" {
									v["value"] = "unrelated"
									return
								}
							}
						}
					case "cycle":
						for _, item := range spans {
							s := item.(map[string]any)
							refs := s["references"].([]any)
							if len(refs) > 0 {
								refs[0].(map[string]any)["spanID"] = s["spanID"]
								return
							}
						}
					}
				})
			}
			if _, e := Normalize(directory, "fan-out"); e == nil {
				t.Fatal("ambiguous evidence accepted")
			}
		})
	}
}
func TestRepeatedRPCsRemainSeparate(t *testing.T) {
	directory := fixtureCopy(t)
	mutateTrace(t, directory, func(raw map[string]any) {
		trace := rawTrace(raw)
		spans := trace["spans"].([]any)
		processes := trace["processes"].(map[string]any)
		root := ""
		for _, item := range spans {
			s := item.(map[string]any)
			p := processes[s["processID"].(string)].(map[string]any)
			if p["serviceName"] != "vtgate" {
				continue
			}
			for _, tag := range s["tags"].([]any) {
				v := tag.(map[string]any)
				if v["key"] == "span.kind" && v["value"] == "client" {
					root = s["spanID"].(string)
					break
				}
			}
			if root != "" {
				break
			}
		}
		cloned := map[string]bool{root: true}
		for changed := true; changed; {
			changed = false
			for _, item := range spans {
				s := item.(map[string]any)
				id := s["spanID"].(string)
				if cloned[id] {
					continue
				}
				for _, ref := range s["references"].([]any) {
					if cloned[ref.(map[string]any)["spanID"].(string)] {
						cloned[id] = true
						changed = true
					}
				}
			}
		}
		for _, item := range spans {
			s := item.(map[string]any)
			id := s["spanID"].(string)
			if !cloned[id] {
				continue
			}
			b, _ := json.Marshal(s)
			var copy map[string]any
			json.Unmarshal(b, &copy)
			copy["spanID"] = id + "-retry"
			for _, ref := range copy["references"].([]any) {
				v := ref.(map[string]any)
				parent := v["spanID"].(string)
				if cloned[parent] {
					v["spanID"] = parent + "-retry"
				}
			}
			trace["spans"] = append(trace["spans"].([]any), copy)
		}
	})
	r, e := Normalize(directory, "fan-out")
	if e != nil {
		t.Fatal(e)
	}
	if r.CaptureStatus != "complete" || len(r.Branches) != 3 {
		t.Fatalf("retry lost: branches %d, warnings %+v", len(r.Branches), r.Warnings)
	}
	found := false
	for _, s := range r.Spans {
		if strings.HasSuffix(s.ID, "-retry") {
			found = true
		}
	}
	if !found {
		t.Fatal("retry spans discarded")
	}
}
func TestFailedCaptureIsDiagnostic(t *testing.T) {
	r, e := Normalize("../../fixtures/20261002T150610Z", "slow-branch")
	if e != nil {
		t.Fatal(e)
	}
	if r.RunID != nil || r.TraceID != nil || r.TimingAvailable || !hasWarning(r, "capture_failed") {
		t.Fatal("failed capture fabricated identity or timing")
	}
}

func TestClockOrderingIsWarnedWithoutAlignment(t *testing.T) {
	directory := fixtureCopy(t)
	id := ""
	var original int64
	mutateTrace(t, directory, func(raw map[string]any) {
		for _, item := range rawTrace(raw)["spans"].([]any) {
			span := item.(map[string]any)
			if span["operationName"] != "TabletServer.Execute" {
				continue
			}
			id = span["spanID"].(string)
			original = int64(span["startTime"].(float64)) - 5000
			span["startTime"] = original
			break
		}
	})
	r, err := Normalize(directory, "fan-out")
	if err != nil {
		t.Fatal(err)
	}
	if !hasWarning(r, "clock_order_uncertain") || r.TimingAvailable {
		t.Fatal("uncertain ordering marked suitable for timing")
	}
	for _, span := range r.Spans {
		if span.ID == id && (span.Start == nil || *span.Start != original) {
			t.Fatal("timestamp silently aligned")
		}
	}
}

func TestCaptureLifecycleControlsExport(t *testing.T) {
	for _, status := range []string{"capturing", "pending", "", "unknown", "complete"} {
		t.Run(status, func(t *testing.T) {
			directory := fixtureCopy(t)
			data, err := json.Marshal(map[string]string{"status": status})
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(directory, "capture-status.json"), data, 0644); err != nil {
				t.Fatal(err)
			}
			paths, err := ExportDirectory(directory)
			if err != nil {
				t.Fatal(err)
			}
			if len(paths) != len(experiments) {
				t.Fatal("missing exported experiments")
			}
			for _, path := range paths {
				var recording Recording
				if err := decode(path, &recording); err != nil {
					t.Fatal(err)
				}
				if status == "complete" {
					if recording.CaptureStatus != "complete" || !recording.TimingAvailable {
						t.Fatal("completed capture was marked incomplete")
					}
				} else if recording.CaptureStatus != "incomplete" || recording.TimingAvailable || !hasWarning(&recording, "capture_unfinished") {
					t.Fatalf("unfinished capture %q exported with status %q and timing %t", status, recording.CaptureStatus, recording.TimingAvailable)
				}
				if recording.RawEvidencePaths["capture_status"] != "../capture-status.json" {
					t.Fatal("capture status source is not linked")
				}
			}
		})
	}
}
