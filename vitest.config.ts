import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [svelte()],
	// package.json "imports" points #named-entity at dist/. tests run against the source's table
	// version; test/entities-dom.test.ts covers the browser one
	resolve: { alias: { '#named-entity': new URL('./src/named-entity.ts', import.meta.url).pathname } },
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node'
	}
});
