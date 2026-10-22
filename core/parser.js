// ###################
// ArcMoon parser: turns tokens into an AST
// ###################

import { TOKEN_TYPES as T } from "./lexer.js";

export const NODE_TYPES = Object.freeze({
	BLOCK: "Block",
	TEXT: "Text",
	COMMENT: "Comment",
	COMMENT_BLOCK: "CommentBlock",
	STATIC_LOGIC: "StaticLogic",
	RUNTIME_LOGIC: "RuntimeLogic",
	IMPORT: "Import",
	SLOT: "Slot",
	FOR_EACH: "ForEach"
});

const N = NODE_TYPES;
const NAME_RE = /^[A-Za-z0-9_$][A-Za-z0-9_$:.-]*$/;
const DIRECTIVE_PREFIX = "arcm-";

export class ParserError extends Error {
	constructor(message, token) {
		const { line, character } = token.range.start;
		super(`${token.source}:${line + 1}:${character + 1}  ${message}`);
		this.name = "ParserError";
		this.source = token.source;
		this.position = { line, character };
	}
}

export default function parser(tokens) {
	if (!Array.isArray(tokens) || tokens.length === 0) throw new TypeError("parser: tokens must be a non-empty array");

	let i = 0;
	const stack = [];

	const peek = () => tokens[i];
	const fail = (message, token = tokens[i]) => {
		throw new ParserError(message, token);
	};

	// ###################
	// Skip spaces and comments inside a header
	// ###################
	const skipJunk = () => {
		while (
			tokens[i].type === T.WHITESPACE ||
			tokens[i].type === T.COMMENT ||
			tokens[i].type === T.COMMENT_BLOCK
		) i++;
	};

	const expect = (type, message) => {
		skipJunk();
		if (peek().type !== type) fail(message);
		return tokens[i++];
	};

	// ###################
	// ${ ... }$ or runtime ${ ... }$
	// ###################
	const parseLogic = () => {
		const start = peek();
		let type = N.STATIC_LOGIC;
		if (start.type === T.RUNTIME_KEYWORD) {
			type = N.RUNTIME_LOGIC;
			i++;
			while (peek().type === T.WHITESPACE) i++;
		}
		expect(T.LOGIC_OPEN, "expected ${ after runtime");
		const codeToken = tokens[i++];
		const close = tokens[i++];
		return { type, code: codeToken.value, codeStart: codeToken.range.start, range: { start: start.range.start, end: close.range.end } };
	};

	// ###################
	// One prop value
	// ###################
	const parseValue = (key) => {
		skipJunk();
		const t = peek();
		if (t.type === T.STRING) return i++, t.value;
		if (t.type === T.NUMBER) return i++, Number(t.value);
		if (t.type === T.BOOLEAN) return i++, t.value === "true";
		if (t.type === T.LOGIC_OPEN || t.type === T.RUNTIME_KEYWORD) return parseLogic();
		if (t.type === T.WORD) {
			const where = key ? ` for prop "${key}"` : "";
			fail(`unquoted value ${t.value}${where}; write "${t.value}" (only true / false and numbers may be unquoted)`);
		}
		fail(key ? `missing value for prop "${key}"` : "expected a value");
	};

	// ###################
	// Props after = : key: value, "value", ...
	// ###################
	const parseProps = (block) => {
		let position = 0;
		while (true) {
			skipJunk();
			const t = peek();
			let key = null;

			if (t.type === T.KEY) {
				key = t.value;
				i++;
				expect(T.COLON, `expected : after "${key}"`);
				const isDirective = key.startsWith(DIRECTIVE_PREFIX);
				const seen = isDirective ? key.slice(DIRECTIVE_PREFIX.length) in block.directives : key in block.props;
				if (seen) fail(`prop "${key}" is written twice`, t);
			}

			const value = parseValue(key);
			if (key === null) block.props[position++] = value;
			else if (key.startsWith(DIRECTIVE_PREFIX)) block.directives[key.slice(DIRECTIVE_PREFIX.length)] = value;
			else block.props[key] = value;

			skipJunk();
			if (peek().type !== T.COMMA) return;
			i++;
			skipJunk();
			if (peek().type === T.CLOSE_BRACKET || peek().type === T.EXCLAMATION_MARK) fail("unexpected , before ]");
		}
	};

	// ###################
	// Header: [name = props !]
	// ###################
	const parseHeader = () => {
		const open = tokens[i++];
		const nameToken = tokens[i++];
		const name = nameToken.value;

		if (nameToken.type === T.END_KEYWORD) fail(`[${name}] has no open block to close`, nameToken);
		if (!NAME_RE.test(name)) fail(`invalid block name "${name}"`, nameToken);

		const block = {
			type: N.BLOCK,
			id: name,
			kind: nameToken.type,
			props: {},
			directives: {},
			isSelfClosing: false,
			body: [],
			range: { start: open.range.start, end: open.range.end }
		};

		skipJunk();
		if (peek().type === T.EQUAL) {
			i++;
			parseProps(block);
		}

		skipJunk();
		if (peek().type === T.EXCLAMATION_MARK) {
			block.isSelfClosing = true;
			i++;
			skipJunk();
			if (peek().type !== T.CLOSE_BRACKET) fail("! must come right before ]");
		}

		const close = expect(T.CLOSE_BRACKET, "expected ] to close the block header");
		block.range.end = close.range.end;
		return block;
	};

	// ###################
	// Turn a block into its special node type
	// ###################
	const finish = (block) => {
		const { kind, props, directives, body, range, isSelfClosing, id } = block;
		const at = { range: { start: range.start }, source: tokens[0].source };

		if (kind === T.IMPORT) {
			const names = Object.keys(props);
			if (!isSelfClosing) fail("[import] must be self-closing: [import = Name: \"./file.arcm\" !]", at);
			if (names.length !== 1 || /^\d+$/.test(names[0]) || typeof props[names[0]] !== "string") {
				fail("[import] needs one name and a quoted path: [import = Name: \"./file.arcm\" !]", at);
			}
			return { type: N.IMPORT, name: names[0], path: props[names[0]], range };
		}

		if (kind === T.SLOT) {
			return { type: N.SLOT, props, body, range };
		}

		if (kind === T.FOR_EACH) {
			if (isSelfClosing) fail("[for-each] needs a body and [end]", at);
			const source = props[0];
			if (!source || (source.type !== N.STATIC_LOGIC && source.type !== N.RUNTIME_LOGIC)) {
				fail("[for-each] needs an array first: [for-each = ${ items }$, as: \"item\"]", at);
			}
			if (props.as !== undefined && typeof props.as !== "string") fail("[for-each] as: must be a quoted name", at);
			if (props.key !== undefined && typeof props.key !== "string") fail("[for-each] key: must be a quoted name", at);
			return { type: N.FOR_EACH, source, as: props.as ?? "value", key: props.key ?? null, props, body, range };
		}

		return { type: N.BLOCK, id, props, directives, isSelfClosing, body, range };
	};

	// ###################
	// [end] or [end:name] for the open block
	// ###################
	const parseEnd = () => {
		const open = stack[stack.length - 1];
		const endOpen = tokens[i++];
		const endToken = tokens[i++];

		if (!open) fail(`[${endToken.value}] has no open block to close`, endToken);
		if (endToken.value.startsWith("end:")) {
			const name = endToken.value.slice(4);
			if (!name) fail("write the block name after end: like [end:div]", endToken);
			if (name !== open.block.id) {
				const { line, character } = open.block.range.start;
				fail(`[end:${name}] does not match [${open.block.id}] opened at ${line + 1}:${character + 1}${swallowedEnd(open.block.range.start)}`, endToken);
			}
		}

		const close = expect(T.CLOSE_BRACKET, "expected ] after end");
		open.block.range.end = close.range.end;
		stack.pop();
		const node = finish(open.block);
		addNode(node, endOpen);
	};

	// ###################
	// A "#" comment that swallowed an [end] after this point: a hint for the error
	// ###################
	const swallowedEnd = (from) => {
		const t = tokens.find(
			(x) => x.type === T.COMMENT && x.value.includes("[end") && (x.range.start.line > from.line || (x.range.start.line === from.line && x.range.start.character > from.character))
		);
		if (!t) return "";
		return `. The "#" on line ${t.range.start.line + 1} starts a comment, which hides the rest of that line, including its [end]. For the character itself, write \\#`;
	};

	const current = () => (stack.length ? stack[stack.length - 1].block.body : root);
	const root = [];
	let seenContent = false;

	// ###################
	// Add a node, joining text next to text
	// ###################
	const addText = (text, token) => {
		const body = current();
		const last = body[body.length - 1];
		if (last && last.type === N.TEXT) {
			last.text += text;
			last.range.end = token.range.end;
		} else {
			body.push({ type: N.TEXT, text, range: { start: token.range.start, end: token.range.end } });
		}
	};

	const addNode = (node, token) => {
		if (node.type === N.IMPORT) {
			if (stack.length || seenContent) fail("[import] must be at the top of the file", token);
		} else if (node.type !== N.COMMENT && node.type !== N.COMMENT_BLOCK) {
			seenContent = true;
		}
		current().push(node);
	};

	while (peek().type !== T.EOF) {
		const t = peek();

		if (t.type === T.TEXT || t.type === T.ESCAPE) {
			addText(t.value, t);
			seenContent = true;
			i++;
		} else if (t.type === T.WHITESPACE) {
			addText(t.value, t);
			i++;
		} else if (t.type === T.COMMENT || t.type === T.COMMENT_BLOCK) {
			const type = t.type === T.COMMENT ? N.COMMENT : N.COMMENT_BLOCK;
			addNode({ type, text: t.value, range: t.range }, t);
			i++;
		} else if (t.type === T.LOGIC_OPEN || t.type === T.RUNTIME_KEYWORD) {
			addNode(parseLogic(), t);
		} else if (t.type === T.OPEN_BRACKET) {
			if (tokens[i + 1].type === T.END_KEYWORD) {
				parseEnd();
				continue;
			}
			const block = parseHeader();
			if (block.isSelfClosing) addNode(finish(block), t);
			else stack.push({ block });
		} else {
			fail(`unexpected ${t.value}`);
		}
	}

	if (stack.length) {
		const { block } = stack[stack.length - 1];
		const { line, character } = block.range.start;
		fail(`[${block.id}] opened at ${line + 1}:${character + 1} is missing [end]${swallowedEnd(block.range.start)}`);
	}

	return root;
}
