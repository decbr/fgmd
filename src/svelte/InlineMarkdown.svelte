<!--
	inline markdown only (no paragraphs, lists or headings), rendered without a wrapping element.
	the same options and snippets as <Markdown>, and the same escaping, but it never imports the
	block parser or the built-in plugin registry, so pages that only render short copy ship far less.

	<p class="lede"><InlineMarkdown source={game.blurb} /></p>
	<InlineMarkdown ast={phrasing} />                  render phrasing content you parsed yourself
-->
<script lang="ts">
	import type { Html, Node, PhrasingContent } from '../ast.js';
	import type { MarkdownOptions } from '../options.js';
	import { parseInline } from '../parse-inline.js';
	import { anchorConfig, footnoteConfig, indexFootnotes } from '../shared.js';
	import { setMarkdownContext, type NodeSnippet } from './context.js';
	import Nodes from './Nodes.svelte';
	import { splitProps, type NodeSnippets } from './props.js';

	interface Props extends Omit<MarkdownOptions, 'renderers' | 'html'>, Omit<NodeSnippets, 'html'> {
		// inline markdown to render
		source?: string;
		// or phrasing content you parsed yourself
		ast?: PhrasingContent[];
		// the html option (true / 'sanitize'), or a snippet for html nodes
		html?: boolean | 'sanitize' | NodeSnippet<Html>;
	}

	let { source = '', ast, ...rest }: Props = $props();

	const split = $derived(splitProps(rest));
	const options = $derived(split.options);

	const nodes = $derived<readonly Node[]>(ast ?? parseInline(source, options));
	const footnotes = $derived(indexFootnotes(nodes));
	const prefix = $derived(options.idPrefix ?? '');
	const notes = $derived(footnoteConfig(options));
	const anchors = $derived(anchorConfig(options));

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
		// headings are block content, so there are never any ids to hand out
		headingIds: new Map(),
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
</script>

<Nodes {nodes} block={false} />
