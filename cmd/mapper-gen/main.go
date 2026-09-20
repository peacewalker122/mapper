package main

import (
	"flag"
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"

	"github.com/peacewalker122/mapper/compiler"
	"github.com/peacewalker122/mapper/idgen"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		// run already printed + set exit code via os.Exit in callers; fallback
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		os.Exit(2)
		return fmt.Errorf("no command")
	}
	switch args[0] {
	case "generate":
		return runGenerate(args[1:])
	case "validate":
		return runValidate(args[1:])
	case "-h", "-help", "--help", "help":
		usage()
		return nil
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", args[0])
		usage()
		os.Exit(2)
		return fmt.Errorf("unknown command")
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  mapper-gen generate [--input X] [--output Y] [--package Z] [input.yaml]")
	fmt.Fprintln(os.Stderr, "  mapper-gen validate <file.yaml>")
}

func runValidate(args []string) error {
	fs := flag.NewFlagSet("validate", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
		return err
	}
	rest := fs.Args()
	if len(rest) == 0 {
		fmt.Fprintln(os.Stderr, "validate: missing input file")
		os.Exit(2)
		return fmt.Errorf("missing input")
	}
	for _, f := range rest {
		data, err := os.ReadFile(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", f, err)
			os.Exit(2)
			return err
		}
		if _, err := compiler.ParseAndValidate(data); err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", f, err)
			os.Exit(1)
			return err
		}
	}
	return nil
}

func runGenerate(args []string) error {
	fs := flag.NewFlagSet("generate", flag.ContinueOnError)
	var input, output, pkg string
	fs.StringVar(&input, "input", "", "input schema YAML")
	fs.StringVar(&output, "output", "", "output generated Go file")
	fs.StringVar(&pkg, "package", "generated", "package name for generated code")
	fs.SetOutput(os.Stderr)
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
		return err
	}
	rest := fs.Args()
	if input == "" && len(rest) > 0 {
		input = rest[0]
	}
	if input == "" {
		fmt.Fprintln(os.Stderr, "generate: missing input file (positional or --input)")
		os.Exit(2)
		return fmt.Errorf("missing input")
	}
	src, err := os.ReadFile(input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read input: %v\n", err)
		os.Exit(2)
		return err
	}
	if output == "" {
		ext := filepath.Ext(input)
		base := strings.TrimSuffix(filepath.Base(input), ext)
		dir := filepath.Dir(input)
		output = filepath.Join(dir, base+".gen.go")
	}
	lockPath := defaultLockPath(input)
	var lockData []byte
	if _, err := os.Stat(lockPath); err == nil {
		lockData, err = os.ReadFile(lockPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "read lock: %v\n", err)
			os.Exit(2)
			return err
		}
	}
	c := &compiler.Compiler{IDGenerator: idgen.CryptoRandomIDGenerator{}}
	res, err := c.Compile(compiler.CompileRequest{Source: src, LockFile: lockData, Package: pkg})
	if err != nil {
		// Distinguish validation vs internal: validation errors are ValidationError or contain known phrases.
		fmt.Fprintf(os.Stderr, "%s: %v\n", input, err)
		os.Exit(1)
		return err
	}
	// Validate generated Go parses.
	if _, err := parser.ParseFile(token.NewFileSet(), output, res.GeneratedGo, parser.AllErrors); err != nil {
		fmt.Fprintf(os.Stderr, "generated Go invalid: %v\n", err)
		os.Exit(2)
		return err
	}
	if err := atomicWrite(lockPath, res.LockFile, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write lock: %v\n", err)
		os.Exit(2)
		return err
	}
	if err := atomicWrite(output, res.GeneratedGo, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write output: %v\n", err)
		os.Exit(2)
		return err
	}
	return nil
}

func defaultLockPath(input string) string {
	ext := filepath.Ext(input)
	base := strings.TrimSuffix(filepath.Base(input), ext)
	dir := filepath.Dir(input)
	// subscriber.yaml -> subscriber.lock.yaml
	if base == "" {
		return filepath.Join(dir, "schema.lock.yaml")
	}
	return filepath.Join(dir, base+".lock.yaml")
}

func atomicWrite(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
