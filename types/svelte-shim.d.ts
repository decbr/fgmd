// lets plain tsc accept .svelte imports. svelte-check resolves the real component types, so this
// fallback only applies when a checker can't read .svelte files itself.
declare module '*.svelte' {
	import type { Component } from 'svelte';
	const component: Component<Record<string, unknown>>;
	export default component;
}
