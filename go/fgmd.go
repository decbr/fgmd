// Package fgmd renders Markdown to HTML with fgmd (https://github.com/decbr/fgmd). It runs the
// npm package's own code in goja, a JavaScript engine written in Go, so the output matches the
// JS library exactly and nothing needs cgo or Node.
package fgmd

//go:generate node gen.mjs

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"runtime"
	"slices"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

//go:embed fgmd.js
var bundle string

const maxCallStack = 10000

type Options struct {
	Settings  map[string]any
	URLPolicy func(url, kind string) (string, bool)
	LinkAttrs func(url string) map[string]string
	Highlight func(code, lang, meta string) (string, bool)
}

type Renderer struct {
	settings string
	opts     Options
}

type Document struct {
	HTML string
	Data map[string]any // frontmatter values (nil if none)
}

func New(opts Options) (*Renderer, error) {
	settings := []byte("{}")
	if opts.Settings != nil {
		var err error
		if settings, err = json.Marshal(opts.Settings); err != nil {
			return nil, fmt.Errorf("fgmd: settings: %w", err)
		}
	}
	r := &Renderer{settings: string(settings), opts: opts}
	// plugins resolve on every parse, so an empty one surfaces a bad name now, not on the first page
	if _, err := r.Markdown(""); err != nil {
		return nil, err
	}
	return r, nil
}

var defaults = &Renderer{settings: "{}"}

func Markdown(src string) (string, error) { return defaults.Markdown(src) }

func (r *Renderer) Markdown(src string) (string, error) {
	doc, err := r.render(src, false)
	return doc.HTML, err
}

func (r *Renderer) Inline(src string) (string, error) {
	doc, err := r.render(src, true)
	return doc.HTML, err
}

func (r *Renderer) Document(src string) (Document, error) { return r.render(src, false) }

func Frontmatter(src string) (data map[string]any, body string, err error) {
	err = withVM(func(v *vm) error {
		res, err := v.frontmatter(goja.Undefined(), v.rt.ToValue(src))
		if err != nil {
			return err
		}
		out := res.ToObject(v.rt)
		body = out.Get("1").String()
		return json.Unmarshal([]byte(out.Get("0").String()), &data)
	})
	return data, body, err
}

func Version() string {
	var version string
	_ = withVM(func(v *vm) error { version = v.version; return nil })
	return version
}

func (r *Renderer) render(src string, inline bool) (doc Document, err error) {
	err = withVM(func(v *vm) error {
		res, err := v.render(goja.Undefined(), v.rt.ToValue(src), v.rt.ToValue(r.settings), v.rt.ToValue(inline), r.hooks(v.rt))
		if err != nil {
			return err
		}
		out := res.ToObject(v.rt)
		doc.HTML = out.Get("0").String()
		if data := out.Get("1").String(); data != "" {
			return json.Unmarshal([]byte(data), &doc.Data)
		}
		return nil
	})
	return doc, err
}

// the Go callbacks as JS functions, or undefined when there are none
func (r *Renderer) hooks(rt *goja.Runtime) goja.Value {
	o := r.opts
	if o.URLPolicy == nil && o.LinkAttrs == nil && o.Highlight == nil {
		return goja.Undefined()
	}
	hooks := rt.NewObject()
	if o.URLPolicy != nil {
		_ = hooks.Set("urlPolicy", func(call goja.FunctionCall) goja.Value {
			url, keep := o.URLPolicy(call.Argument(0).String(), call.Argument(1).String())
			if !keep {
				return goja.Null()
			}
			return rt.ToValue(url)
		})
	}
	if o.LinkAttrs != nil {
		_ = hooks.Set("linkAttrs", func(call goja.FunctionCall) goja.Value {
			attrs := o.LinkAttrs(call.Argument(0).String())
			if attrs == nil {
				return goja.Null()
			}
			obj := rt.NewObject()
			// sorted, so the attributes come out in the same order every time
			for _, name := range slices.Sorted(maps.Keys(attrs)) {
				_ = obj.Set(name, attrs[name])
			}
			return obj
		})
	}
	if o.Highlight != nil {
		_ = hooks.Set("highlight", func(call goja.FunctionCall) goja.Value {
			html, ok := o.Highlight(call.Argument(0).String(), optional(call.Argument(1)), optional(call.Argument(2)))
			if !ok {
				return goja.Undefined()
			}
			return rt.ToValue(html)
		})
	}
	return hooks
}

func optional(v goja.Value) string {
	if goja.IsNull(v) || goja.IsUndefined(v) {
		return ""
	}
	return v.String()
}

type vm struct {
	rt          *goja.Runtime
	render      goja.Callable
	frontmatter goja.Callable
	version     string
}

var (
	compile = sync.OnceValues(func() (*goja.Program, error) { return goja.Compile("fgmd.js", bundle, true) })
	idle    = make(chan *vm, runtime.GOMAXPROCS(0)) // runtimes waiting for work
	slots = make(chan struct{}, cap(idle))
)

func newVM() (*vm, error) {
	program, err := compile()
	if err != nil {
		return nil, fmt.Errorf("fgmd: compiling the bundle: %w", err)
	}
	rt := goja.New()
	rt.SetMaxCallStackSize(maxCallStack)
	if _, err := rt.RunProgram(program); err != nil {
		return nil, jsError(err)
	}
	api := rt.Get("fgmd").ToObject(rt)
	v := &vm{rt: rt, version: api.Get("version").String()}
	var ok bool
	if v.render, ok = goja.AssertFunction(api.Get("render")); !ok {
		return nil, errors.New("fgmd: the bundle has no render function")
	}
	if v.frontmatter, ok = goja.AssertFunction(api.Get("frontmatter")); !ok {
		return nil, errors.New("fgmd: the bundle has no frontmatter function")
	}
	return v, nil
}

func withVM(fn func(*vm) error) error {
	v, err := acquire()
	if err != nil {
		return err
	}
	done := false
	defer func() {
		if done {
			idle <- v
		} else {
			<-slots
		}
	}()
	err = fn(v)
	done = true
	if err != nil {
		return jsError(err)
	}
	return nil
}

func acquire() (*vm, error) {
	select {
	case v := <-idle:
		return v, nil
	default:
	}
	select {
	case v := <-idle:
		return v, nil
	case slots <- struct{}{}:
		v, err := newVM()
		if err != nil {
			<-slots
		}
		return v, err
	}
}

// a thrown JS error as a Go one: "fgmd: <message>"
func jsError(err error) error {
	var ex *goja.Exception
	if !errors.As(err, &ex) {
		if strings.HasPrefix(err.Error(), "fgmd: ") {
			return err
		}
		return fmt.Errorf("fgmd: %w", err)
	}
	msg := ex.Value().String()
	if obj, ok := ex.Value().(*goja.Object); ok {
		if m := obj.Get("message"); m != nil && !goja.IsUndefined(m) {
			msg = m.String()
		}
	}
	return errors.New("fgmd: " + strings.TrimPrefix(msg, "fgmd: "))
}
