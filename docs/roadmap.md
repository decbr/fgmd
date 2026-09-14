# Roadmap

Where fgmd is going, roughly in order. Nothing here is a promise or a date.

## The aim

One parser, every surface, the same output. Markdown written once should come out the same in a browser, in Svelte or React, in a native app, in a terminal, and as data.

Most of the foundation is already here. fgmd passes every CommonMark and GFM spec example, is safe by default, has no dependencies, runs anywhere JavaScript runs, and parses to a plain JSON [tree](tree.md). What's left is making that tree the thing every renderer shares, and making the core fast wherever there's no JIT.

## 1. A core that holds up everywhere

- **Two slow cases.** Under JavaScriptCore with the JIT off (what an iOS app gets), "many reference definitions" takes 23 s and "deeply nested lists" 5 s, where `test/pathological.test.ts` allows 2 s. Under Node, deeply nested lists took 3.2 s in the same benchmark harness. Both should be fast on an interpreter, not only under a JIT.
- **Source positions.** Nodes have no position fields yet. Editors, linters, synced scrolling and useful error messages all need them.
- **Published benchmarks.** Against the other popular JavaScript parsers, with the corpus and the machine stated, slow cases included.

## 2. Streaming

Rendering Markdown while it's still being written, as an LLM sends it. Boo, i know, we hate AI around these parts. But AI is increasingly becoming where most markdown is generated, and the ability to render it in real-time is crucial. Other parsers fail at this at the moment, so it's an extremely great way for fgmd to differentiate itself in my opinion. If you disagree, email me, I guess? An incremental mode keeps finished blocks stable, so they aren't rebuilt on every token, and draws the block that's still open sensibly: an unclosed code fence or a half-typed table shouldn't flicker. The [Svelte component](svelte.md) is where to show it.

## 3. The tree as the product

- **A render-ready tree.** Some decisions live in the renderers today: the URL policy, heading ids, footnote numbers, container titles and `breaks`. A step that writes them into the tree before it leaves JavaScript lets every renderer stay small and agree with the web.
- **A versioned JSON schema** for that tree, so renderers in other languages can decode it with confidence.
- **Renderers**, in this order: React (see [React](react.md)), SwiftUI, the terminal (ANSI), Jetpack Compose.

For SwiftUI, the parser runs in JavaScriptCore, which ships with the OS. With the JIT off it passes every spec example as it is, and parses a typical doc to tree JSON in about 2 ms. A Swift package would decode the tree into enums and draw it as native views: inline text as one `AttributedString` per paragraph, so links and selection work, and blocks as stacks, grids and disclosure groups.

## 4. Round trips

A serialiser from the tree back to Markdown. It makes a formatter possible, along with codemods, editing a document as a tree and saving the file, and CMS workflows.

## 5. Reach

- A playground on fgmd.dev: source, tree and output side by side.
- A VS Code preview.
- The [CLI](cli.md) and its `--serve` mode for every other language.

## Not planned

- **Embedding a JavaScript engine in Go and similar languages.** Tried with goja and a pure-Go QuickJS. Both produced the right output after workarounds, but ran about 18 times slower than Node on ordinary documents, and hostile input could stall them for minutes. Other languages use the CLI, and a native port is the answer if one is ever needed.
- **More plugins for the sake of it.** A few excellent built-ins beat many half-maintained ones. The [plugin API](plugins.md) covers the rest.
- **Rendering raw HTML natively.** Native renderers draw the sanitised elements they understand and skip everything else.

## Measurements

Taken in September 2026 on an AMD Ryzen 5 4500, rendering the README and every file in `docs/` (13 files, 37 KB) to HTML, and running the 71 cases from `test/pathological.test.ts`:

| Engine | README and docs | Pathological cases over 2 s | Slowest case |
| --- | --- | --- | --- |
| Node (V8) | 3.8 ms | 2 | 3.2 s |
| JavaScriptCore, JIT on | 3.7 ms | 0 | 0.5 s |
| JavaScriptCore, JIT off | 31.5 ms | 4 | 23.3 s |

The goja and QuickJS numbers came from a separate Go harness, where the same documents took 149 ms and 144 ms against Node's 8 ms.
