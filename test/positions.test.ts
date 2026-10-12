import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, parseInline, type Node, type ParseOptions } from '../src/index.js';

const load = (file: string): { markdown: string }[] =>
	JSON.parse(readFileSync(new URL(`./spec/${file}`, import.meta.url), 'utf8'));

const examples = [...load('commonmark.json'), ...load('gfm.json')].map((ex) => ex.markdown);

const plugins = ['callouts', 'typography', 'attributes', 'definitionLists', 'abbreviations', 'math', 'wikilinks', 'components'];

const slice = (source: string, node: Node) =>
	node.position ? source.slice(node.position.start.offset, node.position.end.offset) : null;

function strip(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value, (key, v) => (key === 'position' ? undefined : v)));
}

function check(source: string, node: Node, parent: Node | null, problems: string[], exact: boolean): void {
	const position = node.position;
	if (position) {
		const { start, end } = position;
		if (start.offset < 0 || start.offset > end.offset || end.offset > source.length) {
			problems.push(`${node.type} has offsets ${start.offset}-${end.offset}`);
		}
		for (const point of [start, end]) {
			const before = source.slice(0, point.offset);
			const line = before.split(/\r\n|\r|\n/).length;
			const column = point.offset - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) ;
			if (point.line !== line || point.column !== column) problems.push(`${node.type} point ${JSON.stringify(point)}`);
		}
		const outer = parent?.position;
		if (outer && (start.offset < outer.start.offset || end.offset > outer.end.offset)) {
			problems.push(`${node.type} ${start.offset}-${end.offset} outside ${parent.type} ${outer.start.offset}-${outer.end.offset}`);
		}
		const raw = slice(source, node) as string;
		if (exact && node.type === 'text' && !/[\\&<\n\r]/.test(raw) && raw !== node.value) {
			problems.push(`text ${JSON.stringify(node.value)} at ${JSON.stringify(raw)}`);
		}
	}
	if (!('children' in node)) return;
	let previous: Node | null = null;
	for (const child of node.children as Node[]) {
		if (previous?.position && child.position && previous.position.end.offset > child.position.start.offset) {
			problems.push(`${previous.type} overlaps ${child.type}`);
		}
		check(source, child, node, problems, exact);
		if (child.position) previous = child;
	}
}

describe('positions', () => {
	const variants: [string, ParseOptions][] = [
		['defaults', {}],
		['raw HTML', { html: true }],
		['sanitised HTML', { html: 'sanitize' }],
		['every plugin', { plugins: plugins as never }]
	];
	for (const [name, options] of variants) {
		it(`stay inside their parents and in order over every spec example, ${name}`, () => {
			const problems: string[] = [];
			for (const source of examples) {
				const tree = parse(source, { ...options, positions: true });
				expect(strip(tree)).toEqual(strip(parse(source, options)));
				const found: string[] = [];
				check(source, tree, null, found, !options.plugins);
				if (found.length > 0) problems.push(`${JSON.stringify(source)}: ${found.join('; ')}`);
			}
			expect(problems.slice(0, 10)).toEqual([]);
		});
	}

	it('are left off by default', () => {
		expect(JSON.stringify(parse('# a *b*\n\n- c'))).not.toContain('position');
	});

	it('span blocks from their marker to the end of their last line', () => {
		const source = '# Hi *there*\n\n> - a **b**\n>   c\n\n    code\n';
		const tree = parse(source, { positions: true });
		const [heading, quote, code] = tree.children;
		expect(slice(source, heading as Node)).toBe('# Hi *there*');
		expect(slice(source, quote as Node)).toBe('> - a **b**\n>   c');
		expect(slice(source, code as Node)).toBe('    code');
		expect(heading?.position?.start).toEqual({ line: 1, column: 1, offset: 0 });
		expect(code?.position?.end).toEqual({ line: 6, column: 9, offset: source.length - 1 });
	});

	it('span inline nodes over their source, escapes and entities included', () => {
		const source = 'a **b** [l](u) &amp; \\* `c`';
		const [paragraph] = parse(source, { positions: true }).children;
		const spans = (paragraph as { children: Node[] }).children.map((n) => [n.type, slice(source, n)]);
		expect(spans).toEqual([
			['text', 'a '],
			['strong', '**b**'],
			['text', ' '],
			['link', '[l](u)'],
			['text', ' &amp; \\* '],
			['inlineCode', '`c`']
		]);
	});

	it('map table cells through escaped pipes', () => {
		const source = '| x | y \\| z |\n|---|---|\n| 1 | 2 |';
		const [table] = parse(source, { positions: true }).children;
		const rows = (table as { children: { children: Node[] }[] }).children;
		expect(rows.map((row) => row.children.map((cell) => slice(source, cell)))).toEqual([
			['x', 'y \\| z'],
			['1', '2']
		]);
	});

	it('count lines after frontmatter, CRLF and definitions removed from a paragraph', () => {
		const source = '---\ntitle: x\n---\r\n[a]: /u\r\ntext [a]\r\n';
		const tree = parse(source, { positions: true, frontmatter: true });
		const [yaml, paragraph] = tree.children;
		expect(slice(source, yaml as Node)).toBe('---\ntitle: x\n---');
		expect(paragraph?.position?.start).toEqual({ line: 5, column: 1, offset: 27 });
		expect(slice(source, paragraph as Node)).toBe('text [a]');
	});

	it('cover inline components from opening to closing tag', () => {
		const source = 'Press <Kbd>Ctrl</Kbd> now';
		const [paragraph] = parse(source, { positions: true, plugins: ['components'] }).children;
		const component = (paragraph as { children: Node[] }).children[1] as Node;
		expect(slice(source, component)).toBe('<Kbd>Ctrl</Kbd>');
	});

	it('work for parseInline', () => {
		const source = 'a *b*';
		expect(parseInline(source, { positions: true }).map((n) => slice(source, n))).toEqual(['a ', '*b*']);
	});
});
