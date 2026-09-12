import type { Root } from './ast.js';
import type { ParseContext } from './plugin.js';
import { sanitizeTree } from './sanitize.js';

// plugin transforms, in order, then the sanitiser last so nothing a transform makes skips it.
// shared by the block and inline entry points so a document and a line are finished the same way
export function finishTree(root: Root, context: ParseContext): Root {
	for (const plugin of context.options.plugins) {
		if (plugin.transform) root = plugin.transform(root, context) ?? root;
	}
	if (context.options.sanitize) root = sanitizeTree(root, context.options.sanitize);
	return root;
}
