package traces

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCancelledExportKeepsPartialEvidence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":[{"traceID":"captured","spans":[{"spanID":"executor","operationName":"executor.Execute","startTime":100,"duration":10}]}],"errors":null}`))
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	raw, err := Retrieve(ctx, server.URL, 90, 120)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected bounded incomplete export, got %v", err)
	}
	var response struct {
		Data []Trace `json:"data"`
	}
	if e := json.Unmarshal(raw, &response); e != nil {
		t.Fatal(e)
	}
	if len(response.Data) != 1 || response.Data[0].ID != "captured" {
		t.Fatal("partial evidence discarded")
	}
}
