import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

// bundled the same way dist/fgmd.mjs is, into a throwaway directory
let dir: string;
let cli: string;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'fgmd-cli-'));
	cli = join(dir, 'fgmd.mjs');
	await build({
		entryPoints: [new URL('../src/cli.ts', import.meta.url).pathname],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: cli,
		logLevel: 'error',
		plugins: [
			{
				// package.json "imports" points #named-entity at dist/, which a fresh checkout (CI) hasn't
				// built yet. the CLI runs on node, so it's the table version either way
				name: 'named-entity-source',
				setup(b) {
					b.onResolve({ filter: /^#named-entity$/ }, () => ({
						path: new URL('../src/named-entity.ts', import.meta.url).pathname
					}));
				}
			}
		]
	});
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (args: string[], input = '') => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });

describe('cli', () => {
	it('renders stdin', () => {
		const result = run([], '# hi\n');
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('<h1>hi</h1>\n');
	});

	it('renders a file with options', () => {
		const file = join(dir, 'in.md');
		writeFileSync(file, 'a\nb\n');
		expect(run([file, '--options', '{"breaks":true}']).stdout).toBe('<p>a<br />\nb</p>\n');
		expect(run([file, '--options={"breaks":true}', '--inline']).stdout).toBe('a<br />\nb');
	});

	it('serves NDJSON requests, one response per line and in order', () => {
		const input = [
			JSON.stringify({ src: '*a*' }),
			JSON.stringify({ src: 'x', inline: true }),
			'not json',
			JSON.stringify({ src: '<b>raw</b>', options: { html: true } }),
			''
		].join('\n');
		const result = run(['--serve'], input);
		expect(result.status).toBe(0);
		const lines = result.stdout.trim().split('\n').map((l) => JSON.parse(l));
		expect(lines[0]).toEqual({ html: '<p><em>a</em></p>\n' });
		expect(lines[1]).toEqual({ html: 'x' });
		expect(lines[2]).toHaveProperty('error');
		expect(lines[3]).toEqual({ html: '<p><b>raw</b></p>\n' });
	});

	it('applies --options as defaults for every served request', () => {
		const result = run(['--serve', '--options', '{"html":true}'], JSON.stringify({ src: '<i>x</i>' }) + '\n');
		expect(JSON.parse(result.stdout)).toEqual({ html: '<p><i>x</i></p>\n' });
	});

	it('keeps a frontmatter block out of the HTML, and reports it with --data', () => {
		const file = join(dir, 'detour.md');
		writeFileSync(file, '---\ntitle: Detour\nblurb: detour blurb\n---\n\ndetour copy\n');
		expect(run([file, '--frontmatter']).stdout).toBe('<p>detour copy</p>\n');
		expect(JSON.parse(run([file, '--data']).stdout)).toEqual({ title: 'Detour', blurb: 'detour blurb' });
		// without the flag, --- is a thematic break
		expect(run([file]).stdout).toContain('<hr />');
	});

	it('serves the frontmatter values alongside the HTML', () => {
		const input = [
			JSON.stringify({ src: '---\ntitle: Detour\n---\n\ncopy\n' }),
			JSON.stringify({ src: 'no block here' }),
			''
		].join('\n');
		const lines = run(['--serve', '--frontmatter'], input).stdout.trim().split('\n').map((l) => JSON.parse(l));
		expect(lines[0]).toEqual({ html: '<p>copy</p>\n', data: { title: 'Detour' } });
		expect(lines[1]).toEqual({ html: '<p>no block here</p>\n' });
	});

	it('rejects bad arguments with exit code 2', () => {
		expect(run(['--options', '[1]']).status).toBe(2);
		expect(run(['--nope']).status).toBe(2);
		expect(run(['--serve', '--data']).status).toBe(2);
	});

	it('fails with exit code 1 on a missing file', () => {
		const result = run([join(dir, 'missing.md')]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('fgmd:');
	});

	it('prints its version', () => {
		expect(run(['--version']).stdout).toBe(`${VERSION}\n`);
	});
});
