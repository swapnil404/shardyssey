// Package runner owns the local capture and recording lifecycle.
package runner

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"shardyssey/internal/evidence"
	"shardyssey/internal/recording"
)

type Options struct {
	Root         string
	ExperimentID string
	DelayMS      int
}
type Result struct {
	Directory  string           `json:"directory"`
	Recordings []string         `json:"recordings"`
	Gate       *evidence.Report `json:"gate"`
}

// Run accepts a fixed experiment ID, never SQL or visitor-controlled fault commands.
func Run(ctx context.Context, options Options) (Result, error) {
	switch options.ExperimentID {
	case "", "one-shard", "fan-out", "slow-branch":
	default:
		return Result{}, fmt.Errorf("unknown experiment %q", options.ExperimentID)
	}
	if options.DelayMS != 0 && (options.DelayMS < 100 || options.DelayMS > 1000) {
		return Result{}, fmt.Errorf("delay must be 100–1000 ms")
	}
	root, e := filepath.Abs(options.Root)
	if e != nil {
		return Result{}, e
	}
	directory, gate, captureError := (evidence.Capturer{Root: root, ExperimentID: options.ExperimentID, DelayMS: options.DelayMS, DSN: "root@tcp(127.0.0.1:15306)/demo?timeout=5s&readTimeout=10s&writeTimeout=10s", Jaeger: "http://127.0.0.1:16686"}).Capture(ctx)
	result := Result{Directory: directory, Recordings: []string{}, Gate: gate}
	if directory == "" {
		return result, captureError
	}
	if _, e = os.Stat(directory); e != nil {
		return result, captureError
	}
	// Even failed captures produce diagnostic recordings when source identities permit it.
	paths, normalizeError := recording.ExportDirectory(directory)
	result.Recordings = paths
	if normalizeError != nil {
		return result, errors.Join(captureError, normalizeError)
	}
	if captureError != nil {
		return result, captureError
	}
	for _, path := range paths {
		r, e := recording.Normalize(directory, filepath.Base(filepath.Dir(path)))
		if e != nil {
			return result, e
		}
		if r.CaptureStatus != "complete" {
			return result, fmt.Errorf("capture recording is incomplete: %s", r.ExperimentID)
		}
	}
	return result, nil
}
