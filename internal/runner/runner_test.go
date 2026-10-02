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
