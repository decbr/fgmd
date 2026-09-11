// prints spec conformance per section, then every failing example with expected vs actual.
//
//   npm run spec                      both suites, full detail
//   npm run spec -- --summary         pass rates only
//   npm run spec -- --section Tabs    only sections whose name contains "Tabs"
//   npm run spec -- --example 42      one example
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
	const i = args.indexOf(name);
	return i === -1 ? null : args[i + 1];
};

const dir = mkdtempSync(join(tmpdir(), 'fgmd-spec-'));
const outfile = join(dir, 'fgmd.mjs');
await build({
	entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
	logLevel: 'error'
});
const { markdown } = await import(pathToFileURL(outfile).href);
rmSync(dir, { recursive: true, force: true });

const load = (file) => JSON.parse(readFileSync(new URL(`../test/spec/${file}`, import.meta.url), 'utf8'));
const permissive = { html: true, keepComments: true, urlPolicy: (url) => url };
const suites = [
	{ name: 'commonmark', examples: load('commonmark.json'), options: { ...permissive, gfm: false } },
	{ name: 'gfm', examples: load('gfm.json'), options: { ...permissive, gfm: { tagfilter: true } } }
];

const section = value('--section');
const example = value('--example');

for (const suite of suites) {
	const bySection = new Map();
	const failed = [];
	for (const ex of suite.examples) {
		if (section && !ex.section.includes(section)) continue;
		if (example && String(ex.example) !== example) continue;
		let actual;
		try {
			actual = markdown(ex.markdown, suite.options);
		} catch (err) {
			actual = `THREW ${err?.stack ?? err}`;
		}
		const stats = bySection.get(ex.section) ?? { pass: 0, total: 0 };
		stats.total++;
		if (actual === ex.html) stats.pass++;
		else failed.push({ ...ex, actual });
		bySection.set(ex.section, stats);
	}

	let pass = 0;
	let total = 0;
	for (const stats of bySection.values()) {
		pass += stats.pass;
		total += stats.total;
	}
	if (total === 0) continue;
	console.log(`\n== ${suite.name}: ${pass}/${total} (${((pass / total) * 100).toFixed(1)}%)`);
	for (const [name, stats] of bySection) {
		if (stats.pass !== stats.total) console.log(`   ${name}: ${stats.pass}/${stats.total}`);
	}

	if (flag('--summary')) continue;
	for (const ex of failed) {
		console.log(`\n--- ${suite.name} #${ex.example} (${ex.section})`);
		console.log(`input    ${JSON.stringify(ex.markdown)}`);
		console.log(`expected ${JSON.stringify(ex.html)}`);
		console.log(`actual   ${JSON.stringify(ex.actual)}`);
	}
}
