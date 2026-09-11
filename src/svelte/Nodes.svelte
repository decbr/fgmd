<!--
	renders a list of fgmd nodes, recursively. used by <Markdown>, and by snippet overrides that
	want to draw some nodes the normal way. no {@html} anywhere: every string is escaped by Svelte.
-->
<script lang="ts">
	import type { Node, Paragraph, PhrasingContent } from '../ast.js';
	import { VOID_ELEMENTS } from '../sanitize.js';
	import {
		anchorAttributes,
		breakLines,
		classFor,
		containerView,
		cx,
		describe,
		elementAttributes,
		figureImage,
		footnoteIds,
		isBlock,
		isImageOnly,
		isSidenote
	} from '../shared.js';
	import { normalizeUrl } from '../util.js';
	import { getMarkdownContext } from './context.js';
	import Self from './Nodes.svelte';

	interface Props {
		nodes: readonly Node[];
		// true for a list of blocks, false for a line of text
		block?: boolean;
		// paragraphs here belong to a tight list item or description: no <p>
		tight?: boolean;
		// a task item's checkbox, drawn at the start of the first paragraph
		checkbox?: boolean | null;
		// inside an unwrapped image paragraph: line breaks stay plain newlines
		unwrapped?: boolean;
	}

	let { nodes, block = true, tight = false, checkbox = null, unwrapped = false }: Props = $props();
	const ctx = getMarkdownContext();

	// node types whose children are a line of text rather than blocks
	const PHRASING_PARENTS = new Set([
		'paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'mark', 'superscript', 'subscript',
		'abbr', 'tableCell', 'definitionTerm'
	]);

	const d = (node: Node) => describe(node, ctx.options, ctx.headingIds);
	const childNodes = (node: Node): readonly Node[] => ('children' in node ? (node.children as Node[]) : []);
	const childBlock = (node: Node) => !(PHRASING_PARENTS.has(node.type) || (!block && !isBlock(node)));
	const childTight = (node: Node) =>
		node.type === 'list' || node.type === 'definitionDescription' ? !node.spread : node.type === 'listItem' ? tight : false;
	const valueOf = (node: Node): string | null =>
		'value' in node && typeof node.value === 'string' ? node.value : null;
	// a link or image whose URL the policy rejects has no element, and no snippet either
	const overridable = (node: Node) => (node.type === 'link' || node.type === 'image' ? d(node) !== null : true);
</script>

{#snippet taskBox(checked: boolean)}<input
		checked={checked || undefined}
		disabled
		type="checkbox"
		class={classFor(ctx.options.classes, 'input')}
	/>{' '}{/snippet}

{#each nodes as node, index}
	{@const snippet = ctx.snippets[node.type]}
	{#snippet kids()}<Self
			nodes={childNodes(node)}
			block={childBlock(node)}
			tight={childTight(node)}
			checkbox={node.type === 'listItem' ? node.checked : null}
		/>{/snippet}
	{#if snippet && overridable(node)}
		{@render snippet({ node, attributes: d(node)?.attributes ?? {}, children: kids })}
	{:else if node.type === 'paragraph'}
		{@const figure = ctx.options.figures ? figureImage(node) : null}
		{@const img = figure ? d(figure) : null}
		{@const box = index === 0 ? checkbox : null}
		{#if figure && img}{#if box !== null}{@render taskBox(box)}{/if}<figure
				{...elementAttributes('figure', {}, node, ctx.options.classes)}
				><svelte:element this={img.tag} {...img.attributes} title={undefined} /><figcaption
					{...elementAttributes('figcaption', {}, null, ctx.options.classes)}>{figure.title}</figcaption
				></figure
			>{:else if ctx.options.unwrapImages && isImageOnly(node)}{#if box !== null}{@render taskBox(box)}{/if}<Self
				nodes={node.children}
				block={false}
				unwrapped
			/>{:else if tight}{#if box !== null}{@render taskBox(box)}{/if}{@render kids()}{:else}{@const p = d(node)}{#if p}<svelte:element
					this={p.tag}
					{...p.attributes}>{#if box !== null}{@render taskBox(box)}{/if}{@render kids()}</svelte:element
				>{/if}{/if}
	{:else if node.type === 'heading'}
		{@const h = d(node)}
		{@const id = ctx.headingIds.get(node)}
		{@const anchor = ctx.anchors}
		{#if h}<svelte:element this={h.tag} {...h.attributes}
				>{#if anchor && id}{#if anchor.position === 'before'}<svelte:element
							this={'a'}
							{...anchorAttributes(anchor, id, node)}>{anchor.symbol}</svelte:element
						>{@render kids()}{:else if anchor.position === 'after'}{@render kids()}{' '}<svelte:element
							this={'a'}
							{...anchorAttributes(anchor, id, node)}>{anchor.symbol}</svelte:element
						>{:else}<svelte:element this={'a'} {...anchorAttributes(anchor, id, node)}>{@render kids()}</svelte:element
						>{/if}{:else}{@render kids()}{/if}</svelte:element
			>{/if}
	{:else if node.type === 'listItem'}
		{@const li = d(node)}
		{#if li}<svelte:element this={li.tag} {...li.attributes}
				>{#if node.checked !== null && node.children[0]?.type !== 'paragraph'}{@render taskBox(
						node.checked
					)}{/if}{@render kids()}</svelte:element
			>{/if}
	{:else if node.type === 'thematicBreak'}
		{@const hr = d(node)}
		{#if hr}<svelte:element this={hr.tag} {...hr.attributes} />{/if}
	{:else if node.type === 'code'}
		{@const pre = d(node)}
		{#if pre}<svelte:element this={pre.tag} {...pre.attributes}
				><code class={node.lang ? `language-${node.lang}` : undefined}>{node.value}</code></svelte:element
			>{/if}
	{:else if node.type === 'table'}
		{@const t = d(node)}
		{#if t}
			{#if ctx.options.tableWrapperClass}<div class={ctx.options.tableWrapperClass}>{@render table(node, t)}</div
				>{:else}{@render table(node, t)}{/if}
		{/if}
	{:else if node.type === 'container'}
		{@const view = containerView(node, ctx.options)}
		<svelte:element this={view.tag} {...view.attributes}
			>{#if node.title || view.fallbackTitle}<svelte:element this={view.titleTag} {...view.titleAttributes}
					>{#if node.title}<Self nodes={node.title} block={false} />{:else}{view.fallbackTitle}{/if}</svelte:element
				>{/if}{@render kids()}</svelte:element
		>
	{:else if node.type === 'element'}
		{@const el = d(node)}
		{#if el}{#if VOID_ELEMENTS.has(el.tag)}<svelte:element this={el.tag} {...el.attributes} />{:else}<svelte:element
					this={el.tag}
					{...el.attributes}><Self nodes={node.children} {block} /></svelte:element
				>{/if}{/if}
	{:else if node.type === 'html'}
		{node.value}
	{:else if node.type === 'footnoteDefinition'}
		<!-- collected into the footnote section -->
	{:else if node.type === 'text'}
		{#if ctx.options.breaks && !unwrapped && !block}{#each breakLines(node.value, nodes[index - 1] as PhrasingContent | undefined) as part, i}{#if i > 0}{#if part.br}<br
						/>{/if}{'\n'}{/if}{part.text}{/each}{:else}{node.value}{/if}
	{:else if node.type === 'break'}
		<br />
	{:else if node.type === 'image'}
		{@const image = d(node)}
		{#if image}<svelte:element this={image.tag} {...image.attributes} />{:else}{node.alt}{/if}
	{:else if node.type === 'footnoteReference'}
		{@const ref = ctx.footnotes.references.get(node)}
		{#if ref}
			{@const ids = footnoteIds(node.identifier, ref.occurrence, ctx.prefix)}
			{@const side = ref.occurrence === 1 && isSidenote(ref.entry.definition, ctx.notes)}
			<sup class={cx('footnote-ref', side && 'sidenote-ref', classFor(ctx.options.classes, 'sup'))}
				><a href="#{normalizeUrl(ids.definition)}" id={ids.reference} data-footnote-ref>{ref.entry.number}</a></sup
			>{#if side}<span class="sidenote" id={ids.definition}
					><span class="sidenote-number">{ref.entry.number}</span>{' '}<Self
						nodes={(ref.entry.definition.children[0] as Paragraph).children}
						block={false}
					/></span
				>{/if}
		{:else}[^{node.label}]{/if}
	{:else}
		<!-- lists, quotes, definitions, emphasis, links, math, and plugin nodes with an hName -->
		{@const el = d(node)}
		{#if el}<svelte:element this={el.tag} {...el.attributes}
				>{#if 'children' in node}{@render kids()}{:else}{valueOf(node)}{/if}</svelte:element
			>{:else if 'children' in node}{@render kids()}{:else}{valueOf(node)}{/if}
	{/if}
{/each}

{#snippet table(node: Extract<Node, { type: 'table' }>, t: { tag: string; attributes: Record<string, unknown> })}
	<svelte:element this={t.tag} {...t.attributes}>
		{#if node.children[0]}
			{@const head = node.children[0]}
			{@const tr = d(head)}
			<thead {...elementAttributes('thead', {}, null, ctx.options.classes)}>
				<svelte:element this={tr?.tag ?? 'tr'} {...tr?.attributes}>
					{#each head.children as cell, i}
						<th {...elementAttributes('th', { align: node.align[i] ?? undefined }, cell, ctx.options.classes)}
							><Self nodes={cell.children} block={false} /></th
						>
					{/each}
				</svelte:element>
			</thead>
		{/if}
		{#if node.children.length > 1}
			<tbody {...elementAttributes('tbody', {}, null, ctx.options.classes)}>
				{#each node.children.slice(1) as row}
					{@const tr = d(row)}
					<svelte:element this={tr?.tag ?? 'tr'} {...tr?.attributes}>
						{#each row.children as cell, i}
							<td {...elementAttributes('td', { align: node.align[i] ?? undefined }, cell, ctx.options.classes)}
								><Self nodes={cell.children} block={false} /></td
							>
						{/each}
					</svelte:element>
				{/each}
			</tbody>
		{/if}
	</svelte:element>
{/snippet}
