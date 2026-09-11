import type { Plugin } from '../plugin.js';
import { attributes } from './attributes.js';
import { callouts } from './callouts.js';
import { abbreviations, definitionLists, emoji, math, wikilinks } from './small.js';
import { typography } from './typography.js';

export { attributes, type AttributesOptions } from './attributes.js';
export { callouts, type CalloutOptions } from './callouts.js';
export {
	abbreviations,
	definitionLists,
	emoji,
	math,
	wikilinks,
	type AbbreviationOptions,
	type EmojiOptions,
	type MathOptions,
	type WikilinkOptions
} from './small.js';
export { typography, type SmartOptions, type TypographyOptions } from './typography.js';

// every built-in, by the name it's registered under
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const builtinPlugins: Record<string, (options?: any) => Plugin> = {
	abbreviations,
	attributes,
	callouts,
	definitionLists,
	emoji,
	math,
	typography,
	wikilinks
};
