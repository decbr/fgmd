import type { Node } from '../ast.js';
import type { MarkdownOptions } from '../options.js';
import type { NodeSnippet } from './context.js';

// a snippet prop per node type, named after it
export type NodeSnippets = { [K in Node['type']]?: NodeSnippet<Extract<Node, { type: K }>> };

// options that are functions, as opposed to snippets
const OPTION_FUNCTIONS = new Set(['urlPolicy', 'linkAttrs', 'highlight']);

// a component's remaining props, split into fgmd options and node snippets
export function splitProps(rest: Record<string, unknown>): {
	options: MarkdownOptions;
	snippets: Record<string, NodeSnippet | undefined>;
} {
	const options: Record<string, unknown> = {};
	const snippets: Record<string, NodeSnippet | undefined> = {};
	for (const [key, value] of Object.entries(rest)) {
		if (typeof value === 'function' && !OPTION_FUNCTIONS.has(key)) snippets[key] = value as NodeSnippet;
		else options[key] = value;
	}
	return { options: options as MarkdownOptions, snippets };
}
