import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// used by svelte-package and vitest. script: true compiles the component's TypeScript away, so
// the published .svelte file is plain JavaScript that any Svelte 5 toolchain accepts.
export default {
	preprocess: vitePreprocess({ script: true })
};
