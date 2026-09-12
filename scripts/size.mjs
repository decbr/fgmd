// what each entry adds to a browser bundle, minified and gzipped, with svelte itself left out.
// measures the built package (dist/), resolved with the conditions a client build uses. the last
// row uses wrangler's conditions instead, and should always report the entity table: a Worker has
// no DOM to decode with. run `npm run build` first.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

process.chdir(new URL('..', import.meta.url).pathname);

if (!existsSync('dist/index.js')) {
	console.error('dist/ is missing. Run `npm run build` first.');
	process.exit(1);
}

const svelte = {
	name: 'svelte',
	setup(b) {
		b.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
			contents: compile(await readFile(path, 'utf8'), { filename: path, generate: 'client' }).js.code,
			loader: 'js'
		}));
	}
};

const entries = [
	['InlineMarkdown (svelte)', `import { InlineMarkdown } from './dist/svelte/index.js'; console.log(InlineMarkdown);`],
	['Markdown (svelte)', `import { Markdown } from './dist/svelte/index.js'; console.log(Markdown);`],
	['markdownInline (core)', `import { markdownInline } from './dist/index.js'; console.log(markdownInline);`],
	['markdown (core)', `import { markdown } from './dist/index.js'; console.log(markdown);`],
	['markdown (core, Worker)', `import { markdown } from './dist/index.js'; console.log(markdown);`, ['workerd', 'worker']]
];

for (const [label, contents, conditions] of entries) {
	const result = await build({
		stdin: { contents, resolveDir: process.cwd(), loader: 'js' },
		bundle: true,
		minify: true,
		format: 'esm',
		platform: 'browser',
		conditions,
		write: false,
		metafile: true,
		external: ['svelte', 'svelte/*'],
		plugins: [svelte],
		logLevel: 'error'
	});
	const code = result.outputFiles[0].contents;
	const inputs = Object.keys(result.metafile.inputs);
	const table = inputs.some((f) => f.endsWith('dist/entities.js')) ? 'entity table' : 'DOM entities';
	console.log(
		`${label.padEnd(26)} ${String(code.length).padStart(7)} B min ${String(gzipSync(code).length).padStart(7)} B gzip   (${table})`
	);
}
