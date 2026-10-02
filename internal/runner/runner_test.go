package runner

import (
	"context"
	"testing"
)

func TestRejectUnknownExperimentBeforeCapture(t *testing.T) {
	result, err := Run(context.Background(), Options{Root: t.TempDir(), ExperimentID: "SELECT anything"})
	if err == nil || result.Directory != "" {
		t.Fatal("arbitrary experiment reached capture")
	}
}

func TestRejectDelayOutsideBoundsBeforeCapture(t *testing.T) {
	for _, delay := range []int{-1, 1, 99, 1001, 1000000} {
		result, err := Run(context.Background(), Options{Root: t.TempDir(), ExperimentID: "slow-branch", DelayMS: delay})
		if err == nil || result.Directory != "" {
			t.Fatalf("delay %d reached capture", delay)
		}
	}
}
