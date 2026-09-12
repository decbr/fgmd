// package.json "imports" maps this to the table or the DOM decoder at bundle time (see
// src/named-entity.ts and src/named-entity.browser.ts). declared here rather than through tsconfig
// "paths", which esbuild also reads and would use to pin every local bundle to the table
declare module '#named-entity' {
	export function decodeNamedEntity(name: string): string | null;
}
