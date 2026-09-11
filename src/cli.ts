#!/usr/bin/env node
// fgmd on the command line, for builds that aren't JavaScript.
//
//   fgmd post.md                    HTML to stdout
//   cat post.md | fgmd              same, from stdin
//   fgmd --options '{"html":true}'  any JSON-expressible option
//   fgmd --frontmatter post.md      keep a --- metadata block out of the HTML
//   fgmd --data post.md             print that block's keys and values as JSON instead
//   fgmd --serve                    one process for a whole build: NDJSON on stdin/stdout,
//                                   {"src": "...", "options"?: {...}, "inline"?: bool} per line in,
//                                   {"html": "...", "data"?: {...}} or {"error": "..."} per line out
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gemoji } from './emoji-data.js';
import {
	emoji,
	frontmatter,
	markdown,
	markdownInline,
	parse,
	registerPlugin,
	renderHtml,
	VERSION,
	type MarkdownOptions
} from './index.js';

// from the command line, "emoji" means GitHub's full shortcode set
registerPlugin('emoji', (options) => emoji({ map: gemoji, ...options }));

const HELP = `fgmd ${VERSION} - a fucking good markdown parser

usage:
  fgmd [file]            render a file (or stdin) to HTML on stdout
  fgmd --serve           render many documents over NDJSON on stdin/stdout

options:
  --options <json>       render options, e.g. '{"html":true,"breaks":true}'
  --plugins <names>      built-in plugins, comma separated: abbreviations, attributes,
                         callouts, definitionLists, emoji, math, typography, wikilinks
  --inline               inline markdown only, no <p> around it
  --frontmatter          read a --- block at the top as metadata: it stays out of the HTML,
                         and --serve reports it as "data"
  --data                 print that block's keys and values as JSON, instead of the HTML
  --serve                request per line: {"src": "...", "options"?: {...}, "inline"?: true}
                         response per line: {"html": "...", "data"?: {...}} or {"error": "..."}
  -h, --help             this text
  -v, --version          print the version
`;

function fail(message: string, code = 2): never {
	process.stderr.write(`fgmd: ${message}\n`);
	process.exit(code);
}

function parseOptions(raw: string | undefined): MarkdownOptions {
	if (raw === undefined) fail('--options needs a JSON object');
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		fail(`--options is not valid JSON: ${(err as Error).message}`);
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('--options must be a JSON object');
	return value as MarkdownOptions;
}

function listOf(raw: string | undefined): string[] {
	if (raw === undefined) fail('--plugins needs a comma-separated list of names');
	return raw
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);
}

// HTML, plus the frontmatter keys and values when the document has a block and it was asked for
function render(source: string, options: MarkdownOptions, inline: boolean): { html: string; data?: Record<string, unknown> } {
	if (inline) return { html: markdownInline(source, options) };
	if (!options.frontmatter) return { html: markdown(source, options) };
	const tree = parse(source, options);
	const data = tree.data?.frontmatter;
	return data === undefined ? { html: renderHtml(tree, options) } : { html: renderHtml(tree, options), data };
}

function serve(base: MarkdownOptions, inlineByDefault: boolean): void {
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
	lines.on('line', (line) => {
		if (line.trim() === '') return;
		let response: { html: string; data?: Record<string, unknown> } | { error: string };
		try {
			const request = JSON.parse(line) as { src?: unknown; options?: MarkdownOptions; inline?: boolean };
			if (typeof request.src !== 'string') throw new Error('request needs a "src" string');
			const options = { ...base, ...request.options };
			const inline = request.inline ?? inlineByDefault;
			response = render(request.src, options, inline);
		} catch (err) {
			response = { error: (err as Error).message };
		}
		process.stdout.write(JSON.stringify(response) + '\n');
	});
}

function main(argv: string[]): void {
	let file: string | null = null;
	let options: MarkdownOptions = {};
	let serveMode = false;
	let inline = false;
	let dataOnly = false;
	const plugins: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg === '-h' || arg === '--help') {
			process.stdout.write(HELP);
			return;
		}
		if (arg === '-v' || arg === '--version') {
			process.stdout.write(`${VERSION}\n`);
			return;
		}
		if (arg === '--serve') serveMode = true;
		else if (arg === '--inline') inline = true;
		else if (arg === '--frontmatter') options = { ...options, frontmatter: true };
		else if (arg === '--data') dataOnly = true;
		else if (arg === '--options') options = parseOptions(argv[++i]);
		else if (arg.startsWith('--options=')) options = parseOptions(arg.slice('--options='.length));
		else if (arg === '--plugins') plugins.push(...listOf(argv[++i]));
		else if (arg.startsWith('--plugins=')) plugins.push(...listOf(arg.slice('--plugins='.length)));
		else if (arg.startsWith('-') && arg !== '-') fail(`unknown option ${arg}\n\n${HELP}`);
		else if (file !== null) fail('only one input file at a time');
		else file = arg;
	}
	if (plugins.length > 0) options = { ...options, plugins: [...(options.plugins ?? []), ...plugins] };
	// both of these are about the same block, so either flag turns it on
	if (dataOnly) options = { ...options, frontmatter: true };

	if (serveMode) {
		if (file !== null) fail('--serve reads requests from stdin, not a file');
		if (dataOnly) fail('--data renders one document, not a --serve stream');
		serve(options, inline);
		return;
	}

	let source: string;
	try {
		source = readFileSync(file === null || file === '-' ? 0 : file, 'utf8');
	} catch (err) {
		fail((err as Error).message, 1);
	}
	if (dataOnly) {
		process.stdout.write(JSON.stringify(frontmatter(source).data, null, '\t') + '\n');
		return;
	}
	process.stdout.write(render(source, options, inline).html);
}

main(process.argv.slice(2));
