package fgmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dop251/goja"
)

type example struct {
	Markdown string `json:"markdown"`
	HTML     string `json:"html"`
	Example  int    `json:"example"`
	Section  string `json:"section"`
}

func load[T any](t testing.TB, path string) T {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func mustNew(t testing.TB, opts Options) *Renderer {
	t.Helper()
	r, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func allowAll(url, _ string) (string, bool) { return url, true }

// the official examples, with the same options and baseline as test/spec.test.ts
func TestSpec(t *testing.T) {
	baseline := load[map[string]int](t, "../test/spec/baseline.json")
	suites := []struct {
		name     string
		settings map[string]any
	}{
		{"commonmark", map[string]any{"html": true, "keepComments": true, "gfm": false}},
		{"gfm", map[string]any{"html": true, "keepComments": true, "gfm": map[string]any{"tagfilter": true}}},
	}
	for _, suite := range suites {
		t.Run(suite.name, func(t *testing.T) {
			examples := load[[]example](t, "../test/spec/"+suite.name+".json")
			r := mustNew(t, Options{Settings: suite.settings, URLPolicy: allowAll})
			passed := 0
			for _, ex := range examples {
				got, err := r.Markdown(ex.Markdown)
				if err == nil && got == ex.HTML {
					passed++
				} else if testing.Verbose() {
					t.Logf("example %d (%s): %q\nwant %q\ngot  %q (%v)", ex.Example, ex.Section, ex.Markdown, ex.HTML, got, err)
				}
			}
			t.Logf("%s: %d/%d", suite.name, passed, len(examples))
			if passed < baseline[suite.name] {
				t.Errorf("%d passed, baseline is %d", passed, baseline[suite.name])
			}
		})
	}
}

func TestOptions(t *testing.T) {
	r := mustNew(t, Options{Settings: map[string]any{
		"headingIds": true,
		"classes":    map[string]any{"p": "mb-4"},
		"plugins":    []any{"emoji", []any{"math", map[string]any{}}},
	}})
	got, err := r.Markdown("# Hi there\n\nhello :smile:\n")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`<h1 id="hi-there">`, `<p class="mb-4">`, "😄"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}

	inline, err := r.Inline("*a*")
	if err != nil || inline != "<em>a</em>" {
		t.Errorf("Inline = %q, %v", inline, err)
	}
}

func TestDocumentAndFrontmatter(t *testing.T) {
	src := "---\ntitle: Page Title\ntags: [a, b]\n---\n# Body\n"
	r := mustNew(t, Options{Settings: map[string]any{"frontmatter": true}})
	doc, err := r.Document(src)
	if err != nil {
		t.Fatal(err)
	}
	if doc.HTML != "<h1>Body</h1>\n" || doc.Data["title"] != "Page Title" {
		t.Errorf("Document = %#v", doc)
	}

	data, body, err := Frontmatter(src)
	if err != nil || body != "# Body\n" || fmt.Sprint(data["tags"]) != "[a b]" {
		t.Errorf("Frontmatter = %#v, %q, %v", data, body, err)
	}
}

func TestHooks(t *testing.T) {
	r := mustNew(t, Options{
		URLPolicy: func(url, kind string) (string, bool) {
			if strings.HasPrefix(url, "bad:") {
				return "", false
			}
			return strings.Replace(url, "old.example", "new.example", 1), true
		},
		LinkAttrs: func(url string) map[string]string {
			if strings.HasPrefix(url, "/") {
				return nil
			}
			return map[string]string{"target": "_blank", "rel": "noreferrer"}
		},
		Highlight: func(code, lang, meta string) (string, bool) {
			if lang != "go" {
				return "", false
			}
			return "<b>" + strings.TrimSpace(code) + "</b>|" + meta, true
		},
	})
	got, err := r.Markdown("[a](https://old.example) [b](/local) [c](bad:x)\n\n```go title=x\nfunc\n```\n\n```\nplain\n```\n")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<a href="https://new.example" rel="noreferrer" target="_blank">a</a>`,
		`<a href="/local">b</a>`,
		` c</p>`,
		`<b>func</b>|title=x`,
		`<pre><code>plain`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
}

func TestErrors(t *testing.T) {
	_, err := New(Options{Settings: map[string]any{"plugins": []any{"nope"}}})
	if err == nil || !strings.HasPrefix(err.Error(), `fgmd: unknown plugin "nope"`) {
		t.Errorf("New with a bad plugin: %v", err)
	}
	if got, err := Markdown("*ok*"); err != nil || got != "<p><em>ok</em></p>\n" {
		t.Errorf("after an error: %q, %v", got, err)
	}
}

func TestConcurrent(t *testing.T) {
	docs := corpusDocs(t)
	r := mustNew(t, Options{Settings: map[string]any{"plugins": []any{"callouts", "typography"}}})
	want := make([]string, len(docs))
	for i, doc := range docs {
		want[i], _ = r.Markdown(doc)
	}
	var wg sync.WaitGroup
	for g := range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 20 * len(docs) {
				n := (i + g) % len(docs)
				if got, err := r.Markdown(docs[n]); err != nil || got != want[n] {
					t.Errorf("goroutine %d, doc %d: output differs (%v)", g, n, err)
					return
				}
			}
		}()
	}
	wg.Wait()
}

const hostileLimit = 10 * time.Second

func renderWithin(r *Renderer, src string, limit time.Duration) (string, error) {
	var html string
	err := withVM(func(v *vm) error {
		timer := time.AfterFunc(limit, func() { v.rt.Interrupt("timed out") })
		defer func() {
			timer.Stop()
			v.rt.ClearInterrupt()
		}()
		res, err := v.render(goja.Undefined(), v.rt.ToValue(src), v.rt.ToValue(r.settings), v.rt.ToValue(false), r.hooks(v.rt))
		if err != nil {
			return err
		}
		html = res.ToObject(v.rt).Get("0").String()
		return nil
	})
	return html, err
}

func TestPathological(t *testing.T) {
	for _, c := range pathological() {
		t.Run(c.name, func(t *testing.T) {
			r := mustNew(t, Options{Settings: c.settings})
			start := time.Now()
			got, err := renderWithin(r, c.src, hostileLimit)
			took := time.Since(start).Round(time.Millisecond)
			if err != nil {
				t.Fatalf("after %v: %v", took, err)
			}
			if len(got) == 0 && c.settings["plugins"] == nil {
				t.Error("empty output")
			}
			// the same limit the JS suite sets under V8
			if took > 2*time.Second {
				t.Errorf("took %v", took)
			}
		})
	}
}

func TestParity(t *testing.T) {
	type request struct {
		Src          string `json:"src"`
		Settings     string `json:"settings"`
		AllowAllURLs bool   `json:"allowAllUrls,omitempty"`
		name         string
	}
	var requests []request
	add := func(name, src string, settings map[string]any, allowAllURLs bool) {
		raw, _ := json.Marshal(settings)
		if settings == nil {
			raw = []byte("{}")
		}
		requests = append(requests, request{src, string(raw), allowAllURLs, name})
	}
	for _, c := range corpora(t) {
		for i, doc := range c.docs {
			add(fmt.Sprintf("%s #%d", c.name, i), doc, c.settings, false)
		}
	}
	for _, suite := range []string{"commonmark", "gfm"} {
		for _, ex := range load[[]example](t, "../test/spec/"+suite+".json") {
			add(fmt.Sprintf("%s example %d", suite, ex.Example), ex.Markdown, map[string]any{"html": true, "gfm": suite == "gfm"}, true)
			add(fmt.Sprintf("%s example %d (safe)", suite, ex.Example), ex.Markdown, map[string]any{"html": "sanitize", "plugins": allPlugins}, false)
		}
	}
	if !testing.Short() {
		for _, c := range pathological() {
			add(c.name, c.src, c.settings, false)
		}
	}

	var responses []struct {
		HTML  *string `json:"html"`
		Error string  `json:"error"`
	}
	node(t, "parity", requests, &responses)

	failed, timedOut := 0, 0
	for i, req := range requests {
		var settings map[string]any
		_ = json.Unmarshal([]byte(req.Settings), &settings)
		opts := Options{Settings: settings}
		if req.AllowAllURLs {
			opts.URLPolicy = allowAll
		}
		r := mustNew(t, opts)
		got, err := renderWithin(r, req.Src, hostileLimit)
		var interrupted *goja.InterruptedError // TestPathological reports these; there's no output to compare
		if errors.As(err, &interrupted) {
			t.Logf("%s: timed out after %v", req.name, hostileLimit)
			timedOut++
			continue
		}
		want := responses[i]
		switch {
		case want.HTML == nil && err == nil:
			t.Errorf("%s: node threw %q, goja didn't", req.name, want.Error)
		case want.HTML != nil && err != nil:
			t.Errorf("%s: goja threw %v, node didn't", req.name, err)
		case want.HTML != nil && got != *want.HTML:
			t.Errorf("%s: output differs\nsrc  %.200q\nnode %.300q\ngoja %.300q", req.name, req.Src, *want.HTML, got)
		default:
			continue
		}
		if failed++; failed > 20 {
			t.Fatal("too many differences")
		}
	}
	t.Logf("%d documents compared, %d skipped for timing out", len(requests)-timedOut, timedOut)
}

// runs testdata/node.mjs, skipping the test when there's no Node
func node(t testing.TB, mode string, input, output any) {
	t.Helper()
	bin, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	in, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bin, filepath.Join("testdata", "node.mjs"), mode)
	cmd.Stdin = bytes.NewReader(in)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(out, output); err != nil {
		t.Fatal(err)
	}
}

func ExampleNew() {
	r, err := New(Options{Settings: map[string]any{
		"plugins": []any{"callouts"},
		"classes": map[string]any{"a": "link"},
	}})
	if err != nil {
		panic(err)
	}
	html, _ := r.Markdown("Hello [*world*](https://example.com)")
	fmt.Print(html)
	// Output: <p>Hello <a href="https://example.com" class="link"><em>world</em></a></p>
}

var allPlugins = []any{"callouts", "typography", "attributes", "definitionLists", "abbreviations", "math", []any{"emoji", map[string]any{"map": map[string]any{"a": "A"}}}, "wikilinks"}

type pathCase struct {
	name     string
	src      string
	settings map[string]any
}

// test/pathological.test.ts, case for case
func pathological() []pathCase {
	const n = 20000
	rep := strings.Repeat
	lines := func(count int, line func(i int) string, sep string) string {
		parts := make([]string, count)
		for i := range parts {
			parts[i] = line(i)
		}
		return strings.Join(parts, sep)
	}
	var cases []pathCase
	for _, c := range [][2]string{
		{"nested strong emphasis", rep("*a **a ", 2000) + "b" + rep(" a** a*", 2000)},
		{"emphasis closers with no openers", rep("a_ ", n)},
		{"emphasis openers with no closers", rep("_a ", n)},
		{"link closers with no openers", rep("a]", n)},
		{"link openers with no closers", rep("[a", n)},
		{"mismatched openers and closers", rep("*a_ ", n)},
		{"openers and closers multiple of 3", "a**b" + rep("c* ", n)},
		{"link openers and emphasis closers", rep("[ a_", n)},
		{"[ (]( repeated", rep("[ (](", n)},
		{"nested brackets", rep("[", n) + "a" + rep("]", n)},
		{"nested block quotes", rep("> ", n) + "a"},
		{"deeply nested lists", lines(1000, func(i int) string { return rep("  ", i) + "* a" }, "\n")},
		{"nested images", rep("![", 5000) + "a" + rep("](u)", 5000)},
		{"NUL characters", rep("abc\x00de\x00", n)},
		{"backtick runs of growing length", lines(1000, func(i int) string { return "e" + rep("`", i) }, "")},
		{"unclosed links A", rep("[a](<b", n)},
		{"unclosed links B", rep("[a](b", n)},
		{"unclosed <!--", "</" + rep("<!--", n)},
		{"unclosed <?", rep("a <?", n)},
		{"unclosed <!A", rep("a <!A ", n)},
		{"unclosed <![CDATA[", rep("a <![CDATA[", n)},
		{"many reference definitions", rep("[a]: /u\n", n) + "[a]"},
		{"long list", rep("- a\n", n)},
		{"wide table", "|" + rep("a|", 2000) + "\n|" + rep("-|", 2000) + "\n" + rep("|"+rep("b|", 2000)+"\n", 20)},
		{"autolink lookalikes", rep("www.a ", n)},
	} {
		cases = append(cases,
			pathCase{c[0], c[1], map[string]any{"html": false}},
			pathCase{c[0] + " (html)", c[1], map[string]any{"html": true}})
	}
	for _, c := range [][2]string{
		{"dollar runs", rep("$", n)},
		{"unclosed inline math", rep("a$b ", n)},
		{"colon runs", rep(":", n)},
		{"emoji lookalikes", rep(":a:b", n)},
		{"wikilink openers", rep("[[", n)},
		{"unclosed wikilinks", rep("[[a", n)},
		{"mark runs", rep("==", n)},
		{"unclosed marks", rep("==a ", n)},
		{"caret runs", rep("^a", n)},
		{"tilde runs", rep("~a", n)},
		{"brace runs", rep("{", n)},
		{"attribute lookalikes", rep("a {#", n)},
		{"nested containers", lines(1000, func(int) string { return ":::box" }, "\n")},
		{"unclosed container fences", rep(":::box\n", 2000)},
		{"definition markers", "a\n" + rep(": b\n", n/4)},
		{"many abbreviations", rep("*[a]: b\n", 500) + "\n" + rep("a ", n)},
		{"callout lookalikes", rep("> [!NOTE]\n", n/4)},
	} {
		cases = append(cases, pathCase{c[0] + " (plugins)", c[1], map[string]any{"plugins": allPlugins}})
	}
	for _, c := range [][2]string{
		{"deeply nested allowed tags", rep("<b>", n) + "x" + rep("</b>", n)},
		{"deeply nested unknown tags", rep("<foo>", n) + rep("</bar>", n)},
		{"nested spans in a block", "<div>\n" + rep("<span>", n) + "\n</div>"},
		{"many stray closers", rep("a</b>", n)},
	} {
		cases = append(cases, pathCase{c[0] + " (sanitize)", c[1], map[string]any{"html": "sanitize"}})
	}
	return cases
}

type corpus struct {
	name     string
	docs     []string
	settings map[string]any
	bytes    int
}

// README.md and docs/*.md: real documents of the size fgmd is usually handed
func corpusDocs(t testing.TB) []string {
	paths, _ := filepath.Glob("../docs/*.md")
	paths = append([]string{"../README.md"}, paths...)
	docs := make([]string, len(paths))
	for i, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		docs[i] = string(raw)
	}
	return docs
}

func corpora(t testing.TB) []corpus {
	docs := corpusDocs(t)
	var spec []string
	for _, ex := range load[[]example](t, "../test/spec/commonmark.json") {
		spec = append(spec, ex.Markdown)
	}
	cs := []corpus{
		{name: "docs", docs: docs},
		{name: "docs+plugins", docs: docs, settings: map[string]any{
			"headingIds": true,
			"plugins":    []any{"callouts", "typography", "emoji", "math", "attributes"},
		}},
		{name: "spec-examples", docs: spec, settings: map[string]any{"html": true, "gfm": false}},
		{name: "large-doc", docs: []string{strings.Repeat(strings.Join(docs, "\n"), 10)}},
	}
	for i := range cs {
		for _, doc := range cs[i].docs {
			cs[i].bytes += len(doc)
		}
	}
	return slices.Clip(cs)
}
