package fgmd

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
)

// go test -bench . -run '^$'
//
// BenchmarkGoja is this package. BenchmarkServe is the alternative: Node's CLI in --serve mode,
// driven over pipes. TestNodeBench (FGMD_NODE_BENCH=1) times the same corpora in Node, in process.

func BenchmarkGoja(b *testing.B) {
	for _, c := range corpora(b) {
		r := mustNew(b, Options{Settings: c.settings})
		b.Run(c.name, func(b *testing.B) {
			b.SetBytes(int64(c.bytes))
			b.ReportAllocs()
			for b.Loop() {
				for _, doc := range c.docs {
					if _, err := r.Markdown(doc); err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
}

func BenchmarkGojaParallel(b *testing.B) {
	c := corpora(b)[0]
	r := mustNew(b, Options{Settings: c.settings})
	b.SetBytes(int64(c.bytes))
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			for _, doc := range c.docs {
				if _, err := r.Markdown(doc); err != nil {
					b.Error(err)
					return
				}
			}
		}
	})
}

// what a cold runtime costs: the first call on each goroutine pays it once
func BenchmarkStartup(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		if _, err := newVM(); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkServe(b *testing.B) {
	bin, err := exec.LookPath("node")
	if err != nil {
		b.Skip("node is not installed")
	}
	const cli = "../dist/fgmd.mjs"
	if _, err := os.Stat(cli); err != nil {
		b.Skip("dist/fgmd.mjs is not built")
	}
	for _, c := range corpora(b) {
		b.Run(c.name, func(b *testing.B) {
			settings, _ := json.Marshal(c.settings)
			if c.settings == nil {
				settings = []byte("{}")
			}
			cmd := exec.Command(bin, cli, "--serve", "--options", string(settings))
			stdin, _ := cmd.StdinPipe()
			stdout, _ := cmd.StdoutPipe()
			cmd.Stderr = os.Stderr
			if err := cmd.Start(); err != nil {
				b.Fatal(err)
			}
			defer func() { _ = stdin.Close(); _ = cmd.Wait() }()
			requests := json.NewEncoder(stdin)
			responses := bufio.NewReaderSize(stdout, 1<<20)
			roundTrip := func() {
				for _, doc := range c.docs {
					if err := requests.Encode(map[string]string{"src": doc}); err != nil {
						b.Fatal(err)
					}
					line, err := responses.ReadBytes('\n')
					if err != nil {
						b.Fatal(err)
					}
					var res struct{ HTML string }
					if err := json.Unmarshal(line, &res); err != nil {
						b.Fatal(err)
					}
				}
			}
			// warm V8 up, as the in-process Node numbers are
			for range 50 {
				roundTrip()
			}
			b.SetBytes(int64(c.bytes))
			b.ResetTimer()
			for b.Loop() {
				roundTrip()
			}
		})
	}
}

func TestNodeBench(t *testing.T) {
	if os.Getenv("FGMD_NODE_BENCH") == "" {
		t.Skip("set FGMD_NODE_BENCH=1 to time the corpora in Node")
	}
	type job struct {
		Name     string   `json:"name"`
		Docs     []string `json:"docs"`
		Settings string   `json:"settings"`
	}
	var jobs []job
	for _, c := range corpora(t) {
		settings, _ := json.Marshal(c.settings)
		if c.settings == nil {
			settings = []byte("{}")
		}
		jobs = append(jobs, job{c.name, c.docs, string(settings)})
	}
	var results []struct {
		Name    string  `json:"name"`
		NsPerOp float64 `json:"nsPerOp"`
		Ops     int     `json:"ops"`
	}
	node(t, "bench", jobs, &results)
	for i, r := range results {
		mbps := float64(corpora(t)[i].bytes) / 1e6 / (r.NsPerOp / 1e9)
		t.Logf("node/%-14s %12.0f ns/op %8.2f MB/s  (%d ops)", r.Name, r.NsPerOp, mbps, r.Ops)
	}
}
