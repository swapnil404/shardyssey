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
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: shardyssey capture [--root directory] | check evidence-directory")
	}
	switch os.Args[1] {
	case "capture":
		flags := flag.NewFlagSet("capture", flag.ContinueOnError)
		root := flags.String("root", ".", "repository root")
		if err := flags.Parse(os.Args[2:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return fmt.Errorf("unexpected capture arguments")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		directory, report, err := (evidence.Capturer{Root: *root, DSN: "root@tcp(127.0.0.1:15306)/demo?timeout=5s&readTimeout=10s&writeTimeout=10s", Jaeger: "http://127.0.0.1:16686"}).Capture(ctx)
		if err != nil {
			return fmt.Errorf("capture %s: %w", directory, err)
		}
		if err = json.NewEncoder(os.Stdout).Encode(report); err != nil {
			return err
		}
		fmt.Println(directory)
		return nil
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
