// small tree walkers, for transforms and anything else that reads or rewrites a parsed tree
import type { Node, Parent, PhrasingContent, Text } from './ast.js';

// return false to skip a node's children
export type Visitor = (node: Node, parent: Parent | null, index: number) => void | false;

// calls visitor for every node, depth first, parents before children, in document order
export function visit(tree: Node, visitor: Visitor): void {
	const walk = (node: Node, parent: Parent | null, index: number) => {
		if (visitor(node, parent, index) === false) return;
		if ('children' in node) {
			const children = node.children as Node[];
			for (let i = 0; i < children.length; i++) walk(children[i] as Node, node as Parent, i);
		}
	};
	walk(tree, null, -1);
}

// replaces text nodes with whatever fn returns (undefined keeps the node as it is). the nodes
// fn returns aren't visited again. skip(node) returning true leaves that node and everything
// inside it alone, e.g. to stay out of links
export function mapText(
	tree: Node,
	fn: (text: Text, parent: Parent) => PhrasingContent[] | undefined,
	skip?: (node: Node) => boolean
): void {
	const walk = (node: Node) => {
		if (skip?.(node) || !('children' in node)) return;
		const out: Node[] = [];
		for (const child of node.children as Node[]) {
			if (child.type === 'text') {
				const replacement = fn(child, node as Parent);
				if (replacement) {
					out.push(...replacement);
					continue;
				}
			} else {
				walk(child);
			}
			out.push(child);
		}
		(node as { children: Node[] }).children = out;
	};
	walk(tree);
}
