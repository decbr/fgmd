# fgmd

[![npm](https://img.shields.io/npm/v/@decbr/fgmd?logo=npm)](https://www.npmjs.com/package/@decbr/fgmd)
[![tests](https://github.com/decbr/fgmd/actions/workflows/test.yml/badge.svg)](https://github.com/decbr/fgmd/actions/workflows/test.yml)
[![docs](https://img.shields.io/badge/docs-yes-brightgreen.svg)](https://github.com/decbr/fgmd/tree/master/docs)
[![licence](https://img.shields.io/npm/l/@decbr/fgmd)](https://github.com/decbr/fgmd/blob/master/LICENSE)

A f***ing good Markdown parser.

- **Standard.** Passes all 652 CommonMark 0.31.2 spec examples and all 24 GFM extension examples.
- **Safe by default.** Raw HTML is shown as text unless you opt in, and only http, https, mailto, tel and relative URLs get through. Hostile input can't hang or crash it.
- **Extensible.** Eight built-in plugins, plus a plugin API for new inline syntax, block syntax and tree transforms.
- **Zero runtime dependencies.** The library uses no Node APIs, so it runs in Node, Deno and browsers. It has a first-class Svelte 5 component and a CLI for other languages.

## Install

```sh
npm install @decbr/fgmd
```

## Without Svelte

`markdown()` turns a string into HTML:

```js
import { markdown, callouts, math } from '@decbr/fgmd';

markdown('# Hello *world*');
// '<h1>Hello <em>world</em></h1>\n'

markdown(source, {
  plugins: [callouts(), math()],
  headingIds: true,
  classes: { p: 'mb-4', a: 'text-accent' },
  linkAttrs: (url) => (url.startsWith('/') ? null : { target: '_blank', rel: 'noreferrer' })
});
```

For content anyone can write, such as comments, `html: 'sanitize'` lets through a safe, GitHub-like subset of HTML. `markdownInline()` renders a single line without the wrapping `<p>`.

A page's metadata can live in the file, in a `---` block above the copy. `frontmatter()` splits it off:

```js
import { frontmatter } from '@decbr/fgmd';

const { data, body } = frontmatter(source);
// data: { "title": "Page Title", "blurb": "Page Blurb" }, body: the Markdown after the block
```

`markdown(source, { frontmatter: true })` renders the same file with the block left out. See [Syntax](docs/syntax.md#frontmatter).

Using React? See [React](docs/react.md).

From PHP, Python, Ruby or Go, use the [CLI](docs/cli.md):

```sh
cat post.md | fgmd --plugins callouts,typography > post.html
```

## With Svelte

Svelte 5 is an optional peer dependency. The `<Markdown>` component takes the same options as `markdown()`, and it renders real elements with no `{@html}`:

```svelte
<script>
  import { Markdown } from '@decbr/fgmd/svelte';
  import { callouts } from '@decbr/fgmd';
  import source from './privacy.md?raw';
</script>

<Markdown {source} plugins={[callouts()]} classes={{ h2: 'text-2xl mt-10', p: 'mb-4 text-muted' }} />

<!-- short copy: inline markdown, no <p> -->
<p class="lede"><Markdown source={game.blurb} inline /></p>
```

With Vite, a `.md` file can be imported as a string:

```svelte
<script>
    import Prose from '$lib/Prose.svelte';
    import privacy from './privacy.md?raw';
</script>

<Prose source={privacy} />
```

You can also draw any node your own way with a snippet. For that, and more, see [Svelte](docs/svelte.md).

## Documentation

- [Syntax](docs/syntax.md): what's supported, and what changes when coming from a regex-based parser
- [Options](docs/options.md): every parsing and rendering option
- [Plugins](docs/plugins.md): the built-ins, and writing your own
- [Safety](docs/safety.md): what the defaults protect against, and how `html: 'sanitize'` works
- [Svelte](docs/svelte.md): the component, snippets and props
- [React](docs/react.md): rendering in React and Next.js
- [CLI](docs/cli.md): using fgmd from other languages (PHP, etc.)
- [The tree](docs/tree.md): parsing to a tree, walking it and rendering it
- [Recipes](docs/recipes.md): option sets for common sites
- [Development](docs/development.md): tests, spec reports and regenerating data

## License

MIT \
decbr <decbrks@pm.me>