// what the root <Markdown> shares with every <Nodes> below it
import { getContext, setContext, type Snippet } from 'svelte';
import type { Attributes, Heading, Node } from '../ast.js';
import type { RenderOptions } from '../options.js';
import type { AnchorConfig, FootnoteConfig, FootnoteIndex } from '../shared.js';

// what a snippet override receives
export interface NodeSnippetProps<T extends Node = Node> {
	node: T;
	// the attributes fgmd would give the element: URL-checked, with classes and data.hProperties
	attributes: Attributes;
	// renders the node's content the normal way
	children: Snippet;
}

export type NodeSnippet<T extends Node = Node> = Snippet<[NodeSnippetProps<T>]>;

export interface MarkdownContext {
	readonly options: RenderOptions;
	readonly snippets: Readonly<Record<string, NodeSnippet | undefined>>;
	readonly footnotes: FootnoteIndex;
	readonly headingIds: ReadonlyMap<Heading, string>;
	readonly prefix: string;
	readonly anchors: AnchorConfig | null;
	readonly notes: FootnoteConfig;
}

const KEY = Symbol('fgmd');

export function setMarkdownContext(context: MarkdownContext): void {
	setContext(KEY, context);
}

export function getMarkdownContext(): MarkdownContext {
	return getContext<MarkdownContext>(KEY);
}
