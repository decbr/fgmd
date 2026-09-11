// the tree parse() returns. node and field names follow mdast (https://github.com/syntax-tree/mdast)
// so the output is familiar and can be handed to mdast tooling, with two simplifications:
// reference links arrive already resolved as link/image nodes, and there are no position fields.
// soft line breaks stay inside text values as '\n', same as mdast.
//
// plugins add node types by augmenting the content maps, the same way mdast does:
//
//   declare module '@decbr/fgmd' {
//     interface PhrasingContentMap { mention: Mention }
//   }

// extra attributes for an element. false/null/undefined drop the attribute, true writes it bare
export type Attributes = Record<string, string | number | boolean | null | undefined>;

// rendering hints any node can carry (mdast's own convention). both renderers honour them:
// hName renames the element, hProperties adds attributes. a node type neither renderer knows is
// drawn as <hName ...hProperties>children</hName>, or just its children without an hName.
export interface Data {
	hName?: string;
	hProperties?: Attributes;
	frontmatter?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface NodeBase {
	data?: Data;
}

export type AlignType = 'left' | 'right' | 'center' | null;

export interface Root extends NodeBase {
	type: 'root';
	children: BlockContent[];
}

export interface Paragraph extends NodeBase {
	type: 'paragraph';
	children: PhrasingContent[];
}

export interface Heading extends NodeBase {
	type: 'heading';
	depth: 1 | 2 | 3 | 4 | 5 | 6;
	children: PhrasingContent[];
}

export interface ThematicBreak extends NodeBase {
	type: 'thematicBreak';
}

export interface Blockquote extends NodeBase {
	type: 'blockquote';
	children: BlockContent[];
}

export interface List extends NodeBase {
	type: 'list';
	ordered: boolean;
	// null for bullet lists
	start: number | null;
	// true for a loose list, whose items wrap their paragraphs in <p>
	spread: boolean;
	children: ListItem[];
}

export interface ListItem extends NodeBase {
	type: 'listItem';
	// null unless this is a GFM task item
	checked: boolean | null;
	spread: boolean;
	children: BlockContent[];
}

export interface Code extends NodeBase {
	type: 'code';
	// first word of the info string
	lang: string | null;
	// the rest of the info string
	meta: string | null;
	value: string;
}

// the frontmatter block at the top of a document, only produced when parsing with { frontmatter: true }.
export interface Yaml extends NodeBase {
	type: 'yaml';
	value: string;
}

// raw HTML, block or inline. only produced when parsing with { html: true }
export interface Html extends NodeBase {
	type: 'html';
	value: string;
}

export interface Table extends NodeBase {
	type: 'table';
	align: AlignType[];
	// the first row is the header
	children: TableRow[];
}

export interface TableRow extends NodeBase {
	type: 'tableRow';
	children: TableCell[];
}

export interface TableCell extends NodeBase {
	type: 'tableCell';
	children: PhrasingContent[];
}

export interface FootnoteDefinition extends NodeBase {
	type: 'footnoteDefinition';
	// normalised label, used for matching
	identifier: string;
	// label as written
	label: string;
	children: BlockContent[];
}

// a fenced block container: `:::name title` in the source, or a GitHub alert turned into one by
// the callouts plugin
export interface Container extends NodeBase {
	type: 'container';
	name: string;
	title: PhrasingContent[] | null;
	// collapsible containers render as <details>, open or closed to start with
	collapsible: 'open' | 'closed' | null;
	children: BlockContent[];
}

// $$ display math $$ (math plugin)
export interface Math extends NodeBase {
	type: 'math';
	value: string;
	meta: string | null;
}

export interface DefinitionList extends NodeBase {
	type: 'definitionList';
	// like a list: a loose one wraps its descriptions' paragraphs in <p>
	spread: boolean;
	children: (DefinitionTerm | DefinitionDescription)[];
}

export interface DefinitionTerm extends NodeBase {
	type: 'definitionTerm';
	children: PhrasingContent[];
}

export interface DefinitionDescription extends NodeBase {
	type: 'definitionDescription';
	// loose descriptions wrap their paragraphs in <p>: a blank line after the term, or between
	// the description's own blocks, makes one loose
	spread: boolean;
	children: BlockContent[];
}

// an HTML element that came from raw HTML under { html: 'sanitize' }: already filtered, and
// rendered as a real element rather than a string
export interface Element extends NodeBase {
	type: 'element';
	tagName: string;
	properties: Attributes;
	children: (BlockContent | PhrasingContent)[];
}

export interface Text extends NodeBase {
	type: 'text';
	value: string;
}

export interface Emphasis extends NodeBase {
	type: 'emphasis';
	children: PhrasingContent[];
}

export interface Strong extends NodeBase {
	type: 'strong';
	children: PhrasingContent[];
}

export interface Delete extends NodeBase {
	type: 'delete';
	children: PhrasingContent[];
}

export interface InlineCode extends NodeBase {
	type: 'inlineCode';
	value: string;
}

// a hard line break
export interface Break extends NodeBase {
	type: 'break';
}

export interface Link extends NodeBase {
	type: 'link';
	url: string;
	title: string | null;
	children: PhrasingContent[];
}

export interface Image extends NodeBase {
	type: 'image';
	url: string;
	title: string | null;
	alt: string;
}

export interface FootnoteReference extends NodeBase {
	type: 'footnoteReference';
	identifier: string;
	label: string;
}

// ==highlighted== (typography plugin)
export interface Mark extends NodeBase {
	type: 'mark';
	children: PhrasingContent[];
}

// ^superscript^ (typography plugin)
export interface Superscript extends NodeBase {
	type: 'superscript';
	children: PhrasingContent[];
}

// ~subscript~ (typography plugin)
export interface Subscript extends NodeBase {
	type: 'subscript';
	children: PhrasingContent[];
}

// $inline math$, or $$display math$$ inside a paragraph (math plugin)
export interface InlineMath extends NodeBase {
	type: 'inlineMath';
	value: string;
	display: boolean;
}

// a word with an expansion (abbreviations plugin)
export interface Abbr extends NodeBase {
	type: 'abbr';
	title: string;
	children: PhrasingContent[];
}

export interface BlockContentMap {
	paragraph: Paragraph;
	heading: Heading;
	thematicBreak: ThematicBreak;
	blockquote: Blockquote;
	list: List;
	code: Code;
	html: Html;
	table: Table;
	footnoteDefinition: FootnoteDefinition;
	yaml: Yaml;
	container: Container;
	math: Math;
	definitionList: DefinitionList;
	element: Element;
}

export interface PhrasingContentMap {
	text: Text;
	emphasis: Emphasis;
	strong: Strong;
	delete: Delete;
	inlineCode: InlineCode;
	break: Break;
	link: Link;
	image: Image;
	footnoteReference: FootnoteReference;
	html: Html;
	mark: Mark;
	superscript: Superscript;
	subscript: Subscript;
	inlineMath: InlineMath;
	abbr: Abbr;
	element: Element;
}

export type BlockContent = BlockContentMap[keyof BlockContentMap];
export type PhrasingContent = PhrasingContentMap[keyof PhrasingContentMap];

export type Node =
	| Root
	| BlockContent
	| ListItem
	| TableRow
	| TableCell
	| DefinitionTerm
	| DefinitionDescription
	| PhrasingContent;

export type Parent = Extract<Node, { children: unknown[] }>;
