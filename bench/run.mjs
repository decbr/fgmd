import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { HtmlRenderer, Parser } from 'commonmark';
import MarkdownIt from 'markdown-it';
import { marked } from 'marked';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { markdown } from '@decbr/fgmd';
import { cases } from '../test/pathological-cases.ts';

const markdownIt = MarkdownIt({ linkify: true });
const cmParser = new Parser();
const cmRenderer = new HtmlRenderer();

const parsers = {
	fgmd: (src) => markdown(src),
	'markdown-it': (src) => markdownIt.render(src),
	marked: (src) => marked.parse(src),
	micromark: (src) => micromark(src, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }),
	'commonmark.js': (src) => cmRenderer.render(cmParser.parse(src))
};

const LIMIT = 2000;

if (process.argv[2] === '--case') {
	const render = parsers[process.argv[3]];
	const source = cases[Number(process.argv[4])][1];
	const start = performance.now();
	render(source);
	console.log(performance.now() - start);
	process.exit(0);
}

const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const docs = ['README.md', ...readdirSync(new URL('docs', root)).map((f) => `docs/${f}`)].map(read);
const corpus = [
	['README and docs/', docs],
	['CommonMark spec', [read('bench/corpus/spec.md')]]
];

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

function time(render, documents) {
	for (let i = 0; i < 20; i++) documents.forEach(render);
	const rounds = [];
	for (let r = 0; r < 15; r++) {
		const start = performance.now();
		for (let i = 0; i < 10; i++) documents.forEach(render);
		rounds.push((performance.now() - start) / 10);
	}
	return median(rounds);
}

const kb = (documents) => Math.round(documents.reduce((n, d) => n + d.length, 0) / 1024);
const names = Object.keys(parsers);
const row = (cells) => `| ${cells.join(' | ')} |`;

console.log(`${cpus()[0].model.trim()}, Linux ${release()}, Node ${process.version}, ${new Date().toISOString().slice(0, 10)}\n`);
console.log(row(['Document', ...names]));
console.log(row(['---', ...names.map(() => '---:')]));
for (const [name, documents] of corpus) {
	const files = documents.length === 1 ? '1 file' : `${documents.length} files`;
	console.log(row([`${name} (${files}, ${kb(documents)} KB)`, ...names.map((p) => `${time(parsers[p], documents).toFixed(1)} ms`)]));
}

console.log(`\n${row(['Pathological case', ...names])}`);
console.log(row(['---', ...names.map(() => '---:')]));
const slow = Object.fromEntries(names.map((p) => [p, 0]));
cases.forEach(([name], index) => {
	const cells = names.map((p) => {
		const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--case', p, String(index)], {
			timeout: LIMIT + 3000,
			encoding: 'utf8'
		});
		const ms = Number(child.stdout.trim());
		if (child.error || child.signal) return (slow[p]++, 'timed out');
		if (child.status !== 0 || !Number.isFinite(ms)) return (slow[p]++, 'crashed');
		if (ms > LIMIT) return (slow[p]++, `**${(ms / 1000).toFixed(1)} s**`);
		return ms < 1 ? '<1 ms' : `${Math.round(ms)} ms`;
	});
	console.log(row([name.replace(/</g, '&lt;'), ...cells]));
});
console.log(row(['**Over 2 s, crashed or timed out**', ...names.map((p) => `**${slow[p]}**`)]));
