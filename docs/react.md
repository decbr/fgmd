# React

fgmd has no React component yet. I dont use React myself, so I prioritised Svelte. This will come in a future version.

For the time being: `markdown()` returns an HTML string that is safe to put on a page with the default options, so rendering it takes one line:

```jsx
import { useMemo } from 'react';
import { markdown, callouts } from '@decbr/fgmd';

const options = { plugins: [callouts()], classes: { p: 'mb-4', a: 'text-accent' } };

export function Markdown({ source }) {
  const html = useMemo(() => markdown(source, options), [source]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

Keep the options outside the component, or add them to `useMemo`'s dependencies if they change.

For a single line without the wrapping `<p>`, use `markdownInline()`:

```jsx
<span dangerouslySetInnerHTML={{ __html: markdownInline(blurb) }} />
```

## Is `dangerouslySetInnerHTML` safe here?

With the default options, and with `html: 'sanitize'`, yes. Raw HTML is escaped or rebuilt from an allowlist, URLs are checked, and all text and attributes are escaped. See [Safety](safety.md).

`html: true` is not safe for input other people write, since it passes their HTML through untouched. Use it only for content you wrote.

## Server components

In a React Server Component (such as a Next.js App Router page), the Markdown is rendered on the server and the parser never reaches the browser:

```jsx
import { markdown } from '@decbr/fgmd';

export default function Post({ source }) {
  return <article dangerouslySetInnerHTML={{ __html: markdown(source) }} />;
}
```

## Customising the output

Every [option](options.md) works, including `highlight` and `renderers`, because this is HTML output. `classes` sets per-element classes, and `linkAttrs` and `urlPolicy` control links.

## Limitations

Unlike the [Svelte component](svelte.md), there's no way to render a node with your own React component, such as a link as Next.js `<Link>` or a code block as a `<Highlight>`. `renderers` can change a node's HTML, but it returns a string, not React elements.

The usual reason to want `<Link>` is client-side navigation. A click handler on the container gets you that for internal links:

```jsx
'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { markdown } from '@decbr/fgmd';

export function Markdown({ source }) {
  const router = useRouter();
  const html = useMemo(() => markdown(source), [source]);

  function onClick(event) {
    const a = event.target.closest('a');
    if (!a || a.target || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const href = a.getAttribute('href');
    if (!href?.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    router.push(href);
  }

  return <div onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
```

If you need real React elements throughout, `parse()` gives a plain mdast-style tree you can map to elements yourself. See [The tree](tree.md). You'd then be responsible for rendering every node type, including footnotes and plugin nodes.
