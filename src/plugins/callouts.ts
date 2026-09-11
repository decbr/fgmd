// GitHub-style alerts (> [!NOTE]) and :::name containers.
//
//   > [!WARNING]                 > [!TIP] Custom title        > [!NOTE]-          :::details Show me
//   > Mind the gap.              > Body text.                 > Folded away.      Hidden stuff.
//                                                                                 :::
import type { Blockquote, Container, Node, PhrasingContent } from '../ast.js';
import type { Plugin } from '../plugin.js';
import { cx } from '../shared.js';

export interface CalloutOptions {
	// callout types and their default titles, added to GitHub's note/tip/important/warning/caution
	types?: Record<string, string>;
	// class prefix: 'callout' gives class="callout callout-note". default 'callout'
	className?: string;
	// also read :::name containers. default true
	containers?: boolean;
}

const GITHUB_TYPES: Record<string, string> = {
	note: 'Note',
	tip: 'Tip',
	important: 'Important',
	warning: 'Warning',
	caution: 'Caution'
};

const reAlert = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

export function callouts(options: CalloutOptions = {}): Plugin {
	const types: Record<string, string> = { ...GITHUB_TYPES };
	for (const [name, title] of Object.entries(options.types ?? {})) types[name.toLowerCase()] = title;
	const prefix = options.className ?? 'callout';

	// a container named after a callout type becomes that callout; any other stays a plain container
	const style = (node: Container): Container => {
		const title = types[node.name];
		if (title === undefined) return node;
		node.data = {
			...node.data,
			hName: node.collapsible ? 'details' : 'aside',
			hProperties: {
				...node.data?.hProperties,
				class: cx(`${prefix} ${prefix}-${node.name}`, node.data?.hProperties?.class as string | undefined)
			},
			titleClass: `${prefix}-title`
		};
		if (!node.title) node.title = [{ type: 'text', value: title }];
		return node;
	};

	// > [!TYPE] title-on-the-same-line, then the body
	const fromQuote = (quote: Blockquote): Container | null => {
		const first = quote.children[0];
		if (first?.type !== 'paragraph') return null;
		const lead = first.children[0];
		if (lead?.type !== 'text') return null;
		const m = reAlert.exec(lead.value);
		if (!m) return null;
		const name = (m[1] as string).toLowerCase();
		if (!(name in types)) return null;

		// what's left of the marker line is the title; the rest of the paragraph is body
		const title: PhrasingContent[] = [];
		const body: PhrasingContent[] = [];
		let inTitle = true;
		for (const child of [{ ...lead, value: lead.value.slice(m[0].length) }, ...first.children.slice(1)]) {
			if (!inTitle) {
				body.push(child);
			} else if (child.type === 'text') {
				const newline = child.value.indexOf('\n');
				if (newline === -1) {
					if (child.value) title.push(child);
				} else {
					const before = child.value.slice(0, newline).trimEnd();
					const after = child.value.slice(newline + 1);
					if (before) title.push({ type: 'text', value: before });
					if (after) body.push({ type: 'text', value: after });
					inTitle = false;
				}
			} else if (child.type === 'break') {
				inTitle = false;
			} else {
				title.push(child);
			}
		}

		return style({
			type: 'container',
			name,
			title: title.length > 0 ? title : null,
			collapsible: m[2] === '-' ? 'closed' : m[2] === '+' ? 'open' : null,
			children: body.length > 0 ? [{ ...first, children: body }, ...quote.children.slice(1)] : quote.children.slice(1)
		});
	};

	const walk = (node: Node) => {
		if (!('children' in node)) return;
		const children = node.children as Node[];
		for (let i = 0; i < children.length; i++) {
			const child = children[i] as Node;
			if (child.type === 'blockquote') {
				const callout = fromQuote(child);
				if (callout) children[i] = callout;
			}
			walk(children[i] as Node);
		}
	};

	return {
		name: 'callouts',
		block:
			options.containers === false
				? []
				: [
						{
							kind: 'container',
							node: (container) => {
								// :::details folds away, with its title as the summary
								if (container.name === 'details') {
									container.collapsible = 'closed';
									return container;
								}
								return style(container);
							}
						}
					],
		transform(tree) {
			walk(tree);
		}
	};
}
