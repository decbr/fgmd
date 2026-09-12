// markdown in, page out.
//
// every option here is fgmd's, and `html: false` is the load-bearing one: raw HTML in a source
// file renders as literal text, so nothing on this site can smuggle markup past the parser. what
// the pages get instead is markdown - containers, callouts and {.class} attributes - which is
// enough to lay a site out.
import {
	abbreviations,
	attributes,
	callouts,
	definitionLists,
	emoji,
	parse,
	renderHtml,
	toString,
	typography,
	VERSION,
	type MarkdownOptions,
	type Root
} from '@decbr/fgmd';
import { gemoji } from '@decbr/fgmd/emoji';
import { highlight } from './highlight.js';

export const SITE = {
	name: 'fgmd',
	tagline: 'a f***ing good markdown parser',
	origin: 'https://fgmd.dev',
	repo: 'https://github.com/decbr/fgmd',
	// where a page's own source lives on GitHub, so every page can point at the file it came from
	blob: 'https://github.com/decbr/fgmd/blob/master'
};

// links in the docs are written for GitHub - sibling .md files, relative to the file they sit in.
// the same files serve as pages here, so those links are rewritten on the way out rather than the
// docs being rewritten for the site.
const reMarkdownLink = /^([^#?]*?)\.md([#?].*)?$/i;
const reScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function rewriteUrl(url: string): string | null {
	if (reScheme.test(url)) return /^(?:https?|mailto|tel):/i.test(url) ? url : null;
	// already a site URL: /index.md is this page's own source, not a doc to route
	if (url.startsWith('/') || url.startsWith('#')) return url;
	const match = reMarkdownLink.exec(url);
	if (!match) return url;
	const segments = (match[1] ?? '').split('/');
	const name = segments[segments.length - 1] ?? '';
	const tail = match[2] ?? '';
	// README is the index of whichever directory it sits in
	if (name.toLowerCase() === 'readme') return (segments.includes('docs') ? '/docs' : '/') + tail;
	return `/docs/${name.toLowerCase()}${tail}`;
}

function isExternal(url: string): boolean {
	return /^https?:/i.test(url) && !url.startsWith(SITE.origin);
}

export const options: MarkdownOptions = {
	// the whole argument of the site
	html: false,
	frontmatter: true,
	// '#' before a heading, which css hangs in the left margin as the mark it is in the source
	headingAnchors: { position: 'before', symbol: '#' },
	// tables are the one thing narrow screens can't reflow
	tableWrapperClass: 'table-scroll',
	// one-paragraph footnotes sit in the right margin beside the line that refers to them
	footnotes: { style: 'sidenote', heading: 'Notes' },
	lazyImages: true,
	unwrapImages: true,
	figures: true,
	urlPolicy: rewriteUrl,
	linkAttrs: (url) => (isExternal(url) ? { rel: 'noreferrer' } : null),
	highlight,
	plugins: [
		callouts(),
		// ^sup^ and ~sub~ are off: the docs are full of ~~strikethrough~~ and shell paths
		typography({ superscript: false, subscript: false }),
		attributes(),
		definitionLists(),
		abbreviations(),
		emoji({ map: gemoji })
	]
};

export interface Page {
	title: string;
	description: string | null;
	html: string;
	// the markdown this page was made from, served at the page's own URL + .md
	source: string;
	// repo-relative path of that file
	path: string;
}

function frontmatterOf(tree: Root): Record<string, unknown> {
	const data = tree.data?.['frontmatter'];
	return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

// a page's title: the frontmatter's, or the first heading in the file
function titleOf(tree: Root, data: Record<string, unknown>): string {
	if (typeof data['title'] === 'string') return data['title'];
	for (const node of tree.children) {
		if (node.type === 'heading' && node.depth === 1) return toString(node.children);
	}
	return SITE.name;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// the docs carry no frontmatter - they are the files GitHub and npm read, where a `---` block
// would render as a thematic break - so their description comes from the first paragraph
function firstParagraph(tree: Root): string | null {
	for (const node of tree.children) {
		if (node.type !== 'paragraph') continue;
		const value = toString(node.children).replace(/\s+/g, ' ').trim();
		if (value === '') continue;
		return value.length > 160 ? `${value.slice(0, 157).trimEnd()}...` : value;
	}
	return null;
}

export function render(source: string, path: string): Page {
	const tree = parse(source, options);
	const data = frontmatterOf(tree);
	return {
		title: titleOf(tree, data),
		description: text(data['description']) ?? text(data['blurb']) ?? firstParagraph(tree),
		html: renderHtml(tree, options),
		source,
		path
	};
}

// nav and footer are markdown files like any other page, rendered once and reused
export function renderFragment(source: string): string {
	return renderHtml(parse(source, options), options);
}

const escape = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Shell {
	page: Page;
	nav: string;
	footer: string;
	// the page's route, used for canonical links and for the 'source' link in the footer
	route: string;
	cssHash: string;
	// 'home' or 'doc': the only two layouts, told apart by a class on <body>
	layout: 'home' | 'doc';
}

// the one piece of HTML on the site that isn't rendered from markdown: <head>, and the frame the
// rendered markdown sits in.
export function document({ page, nav, footer, route, cssHash, layout }: Shell): string {
	const title = route === '/' ? `${SITE.name} - ${SITE.tagline}` : `${page.title} - ${SITE.name}`;
	const description = page.description ?? SITE.tagline;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta name="generator" content="fgmd ${escape(VERSION)}">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escape(SITE.origin + route)}">
<link rel="canonical" href="${escape(SITE.origin + route)}">
<link rel="alternate" type="text/markdown" href="${escape(route === '/' ? '/index.md' : route + '.md')}" title="This page as markdown">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&amp;display=swap">
<link rel="stylesheet" href="/style.${escape(cssHash)}.css">
</head>
<body class="${layout}">
<a class="skip" href="#content">Skip to content</a>
<header class="masthead">
<a class="wordmark" href="/">fgmd<span aria-hidden="true">.</span></a>
<nav class="site-nav" aria-label="Site">${nav}</nav>
</header>
<main id="content" class="prose">
${page.html}</main>
<footer class="site-footer">
${footer}<p class="source-note">This page is <a href="${escape(route === '/' ? '/index.md' : route + '.md')}">${escape(page.path)}</a>, rendered by fgmd ${escape(VERSION)}. <a href="${escape(`${SITE.blob}/${page.path}`)}" rel="noreferrer">Read it on GitHub</a>.</p>
</footer>
</body>
</html>
`;
}
