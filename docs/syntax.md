# Syntax

## CommonMark covers

- ATX and setext headings
- paragraphs
- `*`/`_` emphasis and strong
- code spans
- fenced and indented code
- block quotes
- nested ordered and bullet lists, loose or tight
- thematic breaks
- inline and reference links and images, with titles and balanced parentheses
- `<autolinks>`
- hard line breaks
- entities and backslash escapes
- raw HTML (opt-in)

## GFM adds

- tables with alignment
- `~~strikethrough~~`
- `- [x]` task lists
- `[^1]` footnotes
- bare `www.`/`https://`/email autolinks

## Additions beyond both specs

- **Comments never ship.** HTML comments and `[//]: # (…)` comment lines are removed, including ones whose note contains parentheses, as in a commented-out image. `keepComments: true` turns this off. Comments inside code are left alone.
- **`unwrapImages`.** A paragraph that holds only images (plus inline HTML like `<video>`) loses its `<p>`, which makes CSS photo grids easy.
- **`breaks` respects a hand-written `<br>`.** A newline straight after a raw `<br>` doesn't become a second break.

Everything else lives in [plugins](plugins.md).

## Coming from a regex-based parser

fgmd follows the spec, so a few things written for a looser parser come out differently:

- **Markdown inside a raw HTML block stays literal.** In `<details><ul><li>**bold**</li></ul></details>`, the asterisks are shown as typed. Either write HTML inside the block (`<strong>`), or leave a blank line after the opening tag. Everything after that blank line is Markdown again. Alternatively, use GFM footnotes with `footnotes: { style: 'details' }`, which produce collapsible footnotes from plain Markdown.
- **A line holding only spaces is a blank line**, so it ends the paragraph or quote before it.
- **A quote swallows the lines that follow it until a blank line** (lazy continuation). End the quote with an empty line if the next text isn't part of it.
- **With `breaks`, every newline breaks**, including the one between an image and a caption written on the next line, and inside quotes. Put a blank line between them to make separate paragraphs instead.
