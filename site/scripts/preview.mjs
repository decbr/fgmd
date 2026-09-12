// runs the Worker on plain node, so the site can be looked at (and its HTML checked in) without
// wrangler or a network. `npm run dev` is still the real thing; this is the quick loop.
//
//   node scripts/preview.mjs            serve on http://localhost:8788
//   node scripts/preview.mjs --dump out render every route to out/ and exit
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const repo = resolve(site, '..');

const bundle = join(site, '.wrangler', 'preview', 'worker.mjs');
mkdirSync(dirname(bundle), { recursive: true });

await build({
	entryPoints: [join(site, 'src', 'worker.ts')],
	outfile: bundle,
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	mainFields: ['module', 'main'],
	conditions: ['workerd', 'worker', 'import', 'default'],
	// the parser is the package one directory up; pointing at its build means the preview works
	// before `npm install` has linked it
	alias: {
		'@decbr/fgmd': join(repo, 'dist', 'index.js'),
		'@decbr/fgmd/emoji': join(repo, 'dist', 'emoji.js')
	},
	logLevel: 'warning'
});

const worker = (await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)).default;

const dumpAt = process.argv.indexOf('--dump');
if (dumpAt !== -1) {
	const out = resolve(process.cwd(), process.argv[dumpAt + 1] ?? 'out');
	const sitemap = await worker.fetch(new Request('http://localhost/sitemap.xml'));
	const routes = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
	mkdirSync(out, { recursive: true });
	for (const route of [...routes, '/404', '/nope']) {
		const response = await worker.fetch(new Request(`http://localhost${route}`));
		const file = join(out, `${route === '/' ? 'index' : route.slice(1).replace(/\//g, '-')}.html`);
		writeFileSync(file, await response.text());
		console.log(`${String(response.status).padEnd(4)} ${route.padEnd(20)} -> ${file}`);
	}
	const css = await worker.fetch(new Request('http://localhost/style.css'));
	console.log(`${css.status}  /style.css -> ${css.headers.get('location')}`);
	process.exit(0);
}

const port = Number(process.env.PORT ?? 8788);
createServer(async (req, res) => {
	const response = await worker.fetch(
		new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers })
	);
	res.writeHead(response.status, Object.fromEntries(response.headers));
	res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}).listen(port, () => console.log(`fgmd site on http://localhost:${port}`));
