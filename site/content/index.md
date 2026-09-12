---
title: fgmd
description: A Markdown parser that passes every CommonMark and GFM spec example with no dependencies.
---

# a f***ing good markdown parser

Every page on this site is a Markdown file. The parser runs with `html: false`, so a `<div>` typed into one of those files renders as the characters `<div>` and nothing else. There is no template language here, no components, and no HTML to fall back on. {.lead}

:::proof The source, and what fgmd made of it
```md
> [!TIP] Read across
> Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
```

> [!TIP] Read across
> Lorem ipsum dolor sit amet, consectetur adipiscing elit, 
> sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
:::

Every page also serves its own source: this one is [index.md](/index.md), and the docs are the same `.md` files that ship on npm and render on GitHub.[^same]

[^same]: One set of files, three renderers. If a doc reads well here and badly on GitHub, that's a bug in the Markdown, not in the site.

## Install

```sh
npm install @decbr/fgmd
```

```js
import { markdown } from '@decbr/fgmd';

markdown('# Hello *world*');
// '<h1>Hello <em>world</em></h1>\n'
```

## What you get

Standard
: All 652 CommonMark 0.31.2 spec examples and all 24 GFM extension examples pass, byte for byte.

Safe by default
: Raw HTML is text unless you ask for it, and only `http`, `https`, `mailto`, `tel` and relative URLs survive. Hostile input can't hang it or crash it.

Extensible
: Eight built-in plugins, and a plugin API for new inline syntax, new block syntax and tree transforms.

Nothing underneath
: Zero runtime dependencies, no Node APIs. It runs in Node, Deno, browsers and - as this site demonstrates - a Cloudflare Worker.

## What this site is made of

| the site | what renders it |
| --- | --- |
| headings, with `#` in the margin | `headingAnchors: { position: 'before' }` |
| the note above, and every warning in the docs | the `callouts` plugin |
| the two-column block above | a `:::proof` container |
| the note in the right margin | `footnotes: { style: 'sidenote' }` |
| `.lead` on the opening paragraph | the `attributes` plugin |
| the curly quotes you're reading | the `typography` plugin |

The options that build it are in [site/src/render.ts](https://github.com/decbr/fgmd/blob/master/site/src/render.ts), and they are ordinary [options](/docs/options) - nothing the site does is unavailable to you.

## Start here

- [Syntax](/docs/syntax) - what's supported, and what changes coming from a regex-based parser
- [Options](/docs/options) - every parsing and rendering option
- [Plugins](/docs/plugins) - the built-ins, and writing your own
- [Svelte](/docs/svelte) - the component, its snippets and props
- [CLI](/docs/cli) - using fgmd from PHP, Python, Ruby or Go
