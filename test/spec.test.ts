// runs the official CommonMark and GFM examples. pass counts may only go up: raise the numbers in
// spec/baseline.json when they do. `npm run spec` lists every failing example.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdown, type MarkdownOptions } from '../src/index.js';

interface Example {
	markdown: string;
	html: string;
	example: number;
	section: string;
}

const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(`./spec/${file}`, import.meta.url), 'utf8')) as T;

const commonmark = load<Example[]>('commonmark.json');
const gfm = load<Example[]>('gfm.json');
const baseline = load<{ commonmark: number; gfm: number }>('baseline.json');

// spec conformance means raw HTML on, comments kept and no URL filtering
const permissive = { html: true, keepComments: true, urlPolicy: (url: string) => url };

function failures(examples: Example[], options: MarkdownOptions): Example[] {
	return examples.filter((ex) => {
		try {
			return markdown(ex.markdown, options) !== ex.html;
		} catch {
			return true;
		}
	});
}

function report(name: string, examples: Example[], failed: Example[], options: MarkdownOptions): void {
	const passed = examples.length - failed.length;
	console.log(`${name}: ${passed}/${examples.length} (${((passed / examples.length) * 100).toFixed(1)}%)`);
	if (!process.env.SPEC_REPORT) return;
	for (const ex of failed) {
		let actual: string;
		try {
			actual = markdown(ex.markdown, options);
		} catch (err) {
			actual = `THREW ${String(err)}`;
		}
		console.log(
			`\n--- ${name} example ${ex.example} (${ex.section})\n${JSON.stringify(ex.markdown)}\nexpected ${JSON.stringify(ex.html)}\nactual   ${JSON.stringify(actual)}`
		);
	}
}

describe('spec conformance', () => {
	it('CommonMark 0.31.2', () => {
		const options: MarkdownOptions = { ...permissive, gfm: false };
		const failed = failures(commonmark, options);
		report('commonmark', commonmark, failed, options);
		expect(commonmark.length - failed.length).toBeGreaterThanOrEqual(baseline.commonmark);
	});

	it('GFM extensions', () => {
		const options: MarkdownOptions = { ...permissive, gfm: { tagfilter: true } };
		const failed = failures(gfm, options);
		report('gfm', gfm, failed, options);
		expect(gfm.length - failed.length).toBeGreaterThanOrEqual(baseline.gfm);
	});
});
