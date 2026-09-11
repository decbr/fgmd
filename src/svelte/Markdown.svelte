<!--
	renders fgmd's AST as Svelte markup. there is no {@html} anywhere in this component: every
	string goes through ordinary interpolation and is escaped, so it is safe for user-written
	content. raw HTML (html: true) shows up as literal text; html: 'sanitize' becomes real elements.

	<Markdown source={md} />                          parse + render
	<Markdown ast={tree} />                           render a tree you parsed yourself
	<Markdown source={line} inline />                 inline markdown, no <p>
	<Markdown source={md} classes={{ p: 'mb-4' }} />  per-element classes

	any node type can be drawn your own way with a snippet named after it:

	<Markdown {source}>
		{#snippet link({ node, attributes, children })}
			<a {...attributes} data-sveltekit-preload-data>{@render children()}</a>
		{/snippet}
	</Markdown>
-->
<script lang="ts">
	import type { Html, Node, PhrasingContent, Root } from '../ast.js';
	import { parse } from '../block.js';
	import { parseInline } from '../index.js';
	import type { MarkdownOptions } from '../options.js';
	import {
		anchorConfig,
		backrefIndex,
		classFor,
		computeHeadingIds,
		cx,
		footnoteConfig,
		footnoteIds,
		indexFootnotes,
		isSidenote,
		splitFootnoteTitle,
		wantsHeadingIds,
		type FootnoteEntry
	} from '../shared.js';
	import { normalizeUrl } from '../util.js';
	import { setMarkdownContext, type NodeSnippet } from './context.js';
	import Nodes from './Nodes.svelte';

	type Snippets = { [K in Node['type']]?: NodeSnippet<Extract<Node, { type: K }>> };

	interface Props extends Omit<MarkdownOptions, 'renderers' | 'html'>, Omit<Snippets, 'html'> {
		// markdown to render
		source?: string;
		// or an already parsed tree (a Root, or phrasing content for inline use)
		ast?: Root | PhrasingContent[];
		// parse source as inline markdown and render it without a wrapping element
		inline?: boolean;
		// the html option (true / 'sanitize'), or a snippet for html nodes
		html?: boolean | 'sanitize' | NodeSnippet<Html>;
	}

	let { source = '', ast, inline = false, ...rest }: Props = $props();

	// options that are functions, as opposed to snippets
	const OPTION_FUNCTIONS = new Set(['urlPolicy', 'linkAttrs', 'highlight']);

	const split = $derived.by(() => {
		const options: Record<string, unknown> = {};
		const snippets: Record<string, NodeSnippet | undefined> = {};
		for (const [key, value] of Object.entries(rest)) {
			if (typeof value === 'function' && !OPTION_FUNCTIONS.has(key)) snippets[key] = value as NodeSnippet;
			else options[key] = value;
		}
		return { options: options as MarkdownOptions, snippets };
	});
	const options = $derived(split.options);

	const tree = $derived(ast ?? (inline ? parseInline(source, options) : parse(source, options)));
	const nodes = $derived<readonly Node[]>(Array.isArray(tree) ? tree : [tree as Root]);
	const phrasingOnly = $derived(Array.isArray(tree));
	const footnotes = $derived(indexFootnotes(nodes));
	const prefix = $derived(options.idPrefix ?? '');
	const headingIds = $derived(wantsHeadingIds(options) ? computeHeadingIds(nodes, footnotes, prefix) : new Map());
	const notes = $derived(footnoteConfig(options));
	const anchors = $derived(anchorConfig(options));
	const entries = $derived(footnotes.entries.filter((entry) => !isSidenote(entry.definition, notes)));
	const details = $derived(notes.style === 'details');

	setMarkdownContext({
		get options() {
			return options;
		},
		get snippets() {
			return split.snippets;
		},
		get footnotes() {
			return footnotes;
		},
		get headingIds() {
			return headingIds;
		},
		get prefix() {
			return prefix;
		},
		get anchors() {
			return anchors;
		},
		get notes() {
			return notes;
		}
	});

	function occurrences(entry: FootnoteEntry): number[] {
		return Array.from({ length: entry.references }, (_, k) => k + 1);
	}
</script>

{#snippet backrefs(entry: FootnoteEntry)}
	{#each occurrences(entry) as k}{#if k > 1}{' '}{/if}<a
			href="#{normalizeUrl(footnoteIds(entry.definition.identifier, k, prefix).reference)}"
			class="footnote-backref"
			data-footnote-backref
			data-footnote-backref-idx={backrefIndex(entry, k)}
			aria-label={notes.backrefLabel.replace('{n}', backrefIndex(entry, k))}
			>{notes.backref}{#if k > 1}<sup class="footnote-ref">{k}</sup>{/if}</a
		>{/each}
{/snippet}

{#if phrasingOnly}
	<Nodes {nodes} block={false} />
{:else}
	<Nodes {nodes} />
	{#if entries.length > 0}
		<section class={cx('footnotes', details && 'footnotes-details', classFor(options.classes, 'section'))} data-footnotes>
			{#if notes.heading}<h2 class="footnotes-heading">{notes.heading}</h2>{/if}
			{#if details}
				{#each entries as entry}
					{@const parts = splitFootnoteTitle(entry.definition)}
					<details class="footnote" id={footnoteIds(entry.definition.identifier, 1, prefix).definition}>
						<summary
							><span class="fn-num">{entry.number}</span>{#if parts.title}{' '}<Nodes
									nodes={parts.title}
									block={false}
								/>{/if}</summary
						>
						<Nodes nodes={parts.body} />
						<p class="fn-back">{@render backrefs(entry)}</p>
					</details>
				{/each}
			{:else}
				<ol>
					{#each entries as entry}
						{@const children = entry.definition.children}
						{@const last = children[children.length - 1]}
						<li id={footnoteIds(entry.definition.identifier, 1, prefix).definition}>
							{#if last?.type === 'paragraph'}
								<Nodes nodes={children.slice(0, -1)} />
								<p class={classFor(options.classes, 'p')}
									><Nodes nodes={last.children} block={false} />{' '}{@render backrefs(entry)}</p
								>
							{:else}
								<Nodes nodes={children} />
								<p>{@render backrefs(entry)}</p>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
{/if}
