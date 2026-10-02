package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"shardyssey/internal/evidence"
	"shardyssey/internal/recording"
	"shardyssey/internal/runner"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: shardyssey capture [--root directory] [--experiment id] | normalize evidence-directory | check evidence-directory")
	}
	switch os.Args[1] {
	case "capture":
		flags := flag.NewFlagSet("capture", flag.ContinueOnError)
		root := flags.String("root", ".", "repository root")
		experiment := flags.String("experiment", "", "one-shard, fan-out, or slow-branch; default captures all")
		if err := flags.Parse(os.Args[2:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return fmt.Errorf("unexpected capture arguments")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		result, err := runner.Run(ctx, runner.Options{Root: *root, ExperimentID: *experiment})
		if encodeError := json.NewEncoder(os.Stdout).Encode(result); encodeError != nil {
			return encodeError
		}
		if err != nil {
			return fmt.Errorf("capture %s: %w", result.Directory, err)
		}
		return nil
	case "normalize":
		if len(os.Args) != 3 {
			return fmt.Errorf("usage: shardyssey normalize evidence-directory")
		}
		paths, err := recording.ExportDirectory(os.Args[2])
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(paths)
	case "check":
		if len(os.Args) != 3 {
			return fmt.Errorf("usage: shardyssey check evidence-directory")
		}
		report, err := evidence.Audit(os.Args[2])
		if err != nil {
			return err
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(report)
	default:
		return fmt.Errorf("unknown command %q", os.Args[1])
	}
}
