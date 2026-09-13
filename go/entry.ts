// the JS side of the Go package: fgmd plus the few functions fgmd.go calls. gen.mjs bundles it

import { gemoji } from '../src/emoji-data.js';
import {
	emoji,
	frontmatter,
	markdown,
	markdownInline,
	parse,
	registerPlugin,
	renderHtml,
	VERSION,
	type MarkdownOptions
} from '../src/index.js';

registerPlugin('emoji', (options) => emoji({ map: gemoji, ...options }));

type Hooks = Pick<MarkdownOptions, 'urlPolicy' | 'linkAttrs' | 'highlight'>; // Go functions, passed through as they are

function render(source: string, settings: string, inline: boolean, hooks?: Hooks): [string, string] {
	const options: MarkdownOptions = { ...(JSON.parse(settings) as MarkdownOptions), ...hooks };
	if (inline) return [markdownInline(source, options), ''];
	if (!options.frontmatter) return [markdown(source, options), ''];
	const tree = parse(source, options);
	const data = tree.data?.frontmatter;
	return [renderHtml(tree, options), data === undefined ? '' : JSON.stringify(data)];
}

function splitFrontmatter(source: string): [string, string] {
	const { data, body } = frontmatter(source);
	return [JSON.stringify(data), body];
}

(globalThis as Record<string, unknown>).fgmd = { version: VERSION, render, frontmatter: splitFrontmatter };
