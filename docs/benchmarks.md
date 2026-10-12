# Benchmarks

fgmd against the other popular JavaScript Markdown parsers, rendering Markdown to HTML. Taken on an AMD Ryzen 5 4500 under Linux 7.2.7, with Node 22.23.3, on 12 October 2026.

| Parser | Version | Configuration |
| --- | --- | --- |
| fgmd | 0.4.1 | defaults: GFM on, raw HTML shown as text |
| markdown-it | 15.0.2 | `linkify: true`, so bare URLs link as they do in fgmd |
| marked | 18.1.1 | defaults: GFM on |
| micromark | 4.0.3 | with `micromark-extension-gfm` 3.0.0 |
| commonmark.js | 0.31.2 | defaults. It has no GFM, so tables and bare URLs are plain text |

## Ordinary documents

The median time to render each set once, over 15 rounds after a warm-up. "README and docs/" is this repository's README and every file in `docs/`; the CommonMark spec is the 0.31.2 `spec.txt`, kept in `bench/corpus/`.

| Document | fgmd | markdown-it | marked | micromark | commonmark.js |
| --- | ---: | ---: | ---: | ---: | ---: |
| README and docs/ (15 files, 53 KB) | 5.5 ms | 4.3 ms | 4.6 ms | 40.9 ms | 1.7 ms |
| CommonMark spec (1 file, 200 KB) | 15.0 ms | 13.2 ms | 11.6 ms | 215.5 ms | 9.9 ms |

On ordinary documents fgmd is 15 to 30% slower than markdown-it and marked, and 1.5 to 3 times slower than commonmark.js, which does less because it has no GFM. micromark is the slowest by a wide margin.

## Pathological input

Each case from `test/pathological.test.ts` runs in its own process. A time in bold is over the 2 s that fgmd's own tests allow. "Timed out" means the process was still running after 5 s and was stopped, and "crashed" means it threw, usually by running out of stack.

| Pathological case | fgmd | markdown-it | marked | micromark | commonmark.js |
| --- | ---: | ---: | ---: | ---: | ---: |
| nested strong emphasis | 35 ms | 50 ms | crashed | timed out | 37 ms |
| emphasis closers with no openers | 42 ms | 62 ms | 50 ms | timed out | 63 ms |
| emphasis openers with no closers | 39 ms | 59 ms | timed out | 191 ms | 53 ms |
| link closers with no openers | 26 ms | 22 ms | 8 ms | timed out | 40 ms |
| link openers with no closers | 28 ms | 105 ms | 41 ms | 171 ms | 36 ms |
| mismatched openers and closers | 71 ms | 100 ms | timed out | timed out | 104 ms |
| openers and closers multiple of 3 | 40 ms | 64 ms | 41 ms | timed out | 50 ms |
| link openers and emphasis closers | 63 ms | 181 ms | 57 ms | timed out | 70 ms |
| [ (]( repeated | 67 ms | 61 ms | 57 ms | timed out | 91 ms |
| nested brackets | 37 ms | 84 ms | 42 ms | **3.5 s** | 31 ms |
| nested block quotes | 9 ms | 4 ms | crashed | 1242 ms | 55 ms |
| deeply nested lists | 27 ms | 15 ms | timed out | timed out | **2.4 s** |
| nested images | 22 ms | 73 ms | 39 ms | timed out | 28 ms |
| NUL characters | 14 ms | 16 ms | 13 ms | 123 ms | 7 ms |
| backtick runs of growing length | 15 ms | 15 ms | 1005 ms | timed out | 375 ms |
| unclosed links A | 77 ms | 53 ms | 80 ms | **3.9 s** | 115 ms |
| unclosed links B | 112 ms | 53 ms | 66 ms | **3.8 s** | timed out |
| unclosed &lt;!-- | 38 ms | 41 ms | 572 ms | timed out | 578 ms |
| unclosed &lt;? | 31 ms | 27 ms | 337 ms | timed out | 345 ms |
| unclosed &lt;!A | 39 ms | 37 ms | 502 ms | timed out | 1648 ms |
| unclosed &lt;![CDATA[ | 72 ms | 351 ms | 609 ms | timed out | 651 ms |
| many reference definitions | 63 ms | 88 ms | 69 ms | 1110 ms | 53 ms |
| long list | 146 ms | 177 ms | 133 ms | 1004 ms | 123 ms |
| wide table | 114 ms | 198 ms | 112 ms | 766 ms | 2 ms |
| autolink lookalikes | 106 ms | 9 ms | 64 ms | 255 ms | 2 ms |
| **Over 2 s, crashed or timed out** | **0** | **0** | **5** | **17** | **2** |

fgmd and markdown-it finish every case well within the limit. The 2 ms results for commonmark.js on the wide table and autolink lookalikes are because it doesn't support tables or bare URLs, so those inputs are plain text to it.

## Running it

```sh
npm run build
cd bench && npm install && npm run bench
```

`bench/run.mjs` prints both tables in this format. The results move by a few per cent between runs.

To time fgmd under JavaScriptCore without a JIT, as an iOS app runs it, see [Development](development.md).
