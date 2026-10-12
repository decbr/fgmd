<!-- a component for the components plugin, for test/svelte.test.ts -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { kind = 'note', href, children }: { kind?: string; href?: string; children?: Snippet } = $props();
</script>

<aside class="note-{kind}" data-href={href}>{@render children?.()}</aside>
