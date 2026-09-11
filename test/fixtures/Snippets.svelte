<!-- snippet overrides, for test/svelte.test.ts -->
<script lang="ts">
	import Markdown from '../../src/svelte/Markdown.svelte';

	let { source }: { source: string } = $props();
</script>

<Markdown {source}>
	{#snippet link({ attributes, children })}<a {...attributes} data-custom="yes">{@render children()}</a>{/snippet}
	{#snippet code({ node })}<div class="code-box" data-lang={node.lang}>{node.value}</div>{/snippet}
	{#snippet heading({ node, attributes, children })}<svelte:element this={`h${node.depth + 1}`} {...attributes}
			>{@render children()}</svelte:element
		>{/snippet}
</Markdown>
