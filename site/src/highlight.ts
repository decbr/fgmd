// a small syntax highlighter for the languages the docs actually use, wired into fgmd's
// `highlight` option. no dependency, no build step, and no attempt at being a parser: it marks
// comments, strings, numbers and keywords, and leaves everything else alone.
//
// the markdown lexer is the one that earns its place - it puts the marks (#, >, -, :::, ```) in
// the same red the rendered headings use, so a source block and its output line up by colour.

type Rules = readonly (readonly [RegExp, string])[];

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KEYWORDS =
	'import|export|from|as|default|declare|const|let|var|function|return|class|extends|implements|interface|type|enum|new|delete|typeof|instanceof|in|of|for|while|do|if|else|switch|case|break|continue|throw|try|catch|finally|await|async|yield|void|this|super|true|false|null|undefined|readonly|public|private|protected|static|satisfies|keyof|infer|is';

const js: Rules = [
	[/\/\/[^\n]*|\/\*[\s\S]*?\*\//, 'c'],
	[/`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"/, 's'],
	[new RegExp(`\\b(?:${KEYWORDS})\\b`), 'k'],
	[/\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b/, 'n']
];

const json: Rules = [
	[/"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/, 'p'],
	[/"(?:\\[\s\S]|[^"\\])*"/, 's'],
	[/\/\/[^\n]*/, 'c'],
	[/\b(?:true|false|null)\b/, 'k'],
	[/-?\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b/, 'n']
];

const shell: Rules = [
	[/#[^\n]*/, 'c'],
	[/'[^'\n]*'|"(?:\\[\s\S]|[^"\\\n])*"/, 's'],
	[/(?<=^|\s)--?[A-Za-z][\w-]*/, 'f'],
	[/(?<=^|[|;&]\s*)[a-z][\w.-]*/, 'k']
];

const md: Rules = [
	// whole-line marks: fences, container markers, thematic breaks, setext underlines
	[/^[ \t]*(?:```+[^\n]*|~~~+[^\n]*|:::[^\n]*|---+|===+)$/m, 'm'],
	// heading, quote and list marks, plus a task box
	[/^[ \t]*(?:#{1,6}|>+|[-*+]|\d+[.)])(?= )|(?<=^[ \t]*[-*+] )\[[ xX]\]/m, 'm'],
	[/\[![A-Za-z][\w-]*\][+-]?/, 'k'],
	[/`[^`\n]+`/, 'p'],
	[/\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==/, 'e'],
	[/^[ \t]*\[[^\]\n]+\]:[^\n]*/m, 's']
];

const LANGUAGES: Record<string, Rules> = {
	js,
	javascript: js,
	ts: js,
	typescript: js,
	jsx: js,
	tsx: js,
	svelte: js,
	json: json,
	jsonc: json,
	sh: shell,
	bash: shell,
	shell: shell,
	console: shell,
	md,
	markdown: md
};

// one regex per language, built once: each rule becomes a capture group,
// and the group that matched names the class
const compiled = new Map<Rules, RegExp>();

function patternFor(rules: Rules): RegExp {
	let re = compiled.get(rules);
	if (!re) {
		re = new RegExp(rules.map(([rule]) => `(${rule.source})`).join('|'), 'gm');
		compiled.set(rules, re);
	}
	return re;
}

export function highlight(code: string, lang: string | null): string | null {
	const rules = lang ? LANGUAGES[lang.toLowerCase()] : undefined;
	if (!rules) return null;
	const pattern = patternFor(rules);
	pattern.lastIndex = 0;
	let out = '';
	let last = 0;
	for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
		// a rule that can match nothing would spin forever
		if (match[0] === '') {
			pattern.lastIndex++;
			continue;
		}
		const index = match.findIndex((value, i) => i > 0 && value !== undefined);
		const cls = rules[index - 1]?.[1];
		if (!cls) continue;
		out += escapeHtml(code.slice(last, match.index));
		out += `<span class="t-${cls}">${escapeHtml(match[0])}</span>`;
		last = match.index + match[0].length;
	}
	return out + escapeHtml(code.slice(last));
}
