// ###################
// diagnose: errors in ArcMoon code, for the live editor
//   ArcMoon: the lexer and parser (one error: after it the markup can't be trusted)
//   JavaScript: every ${ }$ parsed with acorn, like the compiler does
//   ArcMoon's JS rules: export in runtime code, Node.js imports in the browser…
// → [{ from, to, line, column, text, severity, source: "ArcMoon" | "JavaScript", message }]
//   from / to: offsets; line / column: where it starts, from 1; text: the underlined part
// ###################

import * as acorn from "acorn";
import jsTokens from "js-tokens";
import lexer from "../../../core/lexer.js";
import parser from "../../../core/parser.js";
import closest from "../../../core/suggest.js";

const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true };

// ###################
// Node.js modules: an import of these in runtime code can't work in the browser
// ###################
const NODE = new Set([
	"assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
	"dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process",
	"punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events", "tty", "url",
	"util", "v8", "vm", "wasi", "worker_threads", "zlib"
]);

const offsets = (src) => {
	const starts = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
	return ({ line, character }) => Math.min((starts[line] ?? src.length) + character, src.length);
};

// ###################
// The word (or one character) at an offset, for the underline
// ###################
const rangeAt = (src, from) => {
	const word = /^\$\{|^[\w$]+|^[^\s]/.exec(src.slice(from))?.[0].length ?? 0;
	return { from, to: Math.min(from + Math.max(word, 1), src.length) };
};

// ###################
// A node's range, cut at the end of its first line
// ###################
const lineRange = (src, from, to) => {
	const eol = src.indexOf("\n", from);
	return { from, to: Math.max(from + 1, eol === -1 ? to : Math.min(to, eol)) };
};

const arcmoonMessage = (err) => String(err.message).replace(/^\S+:\d+:\d+\s+/, "");

// ###################
// Every ${ }$ from the tokens, with what it is: build or runtime; a block, a prop value or a live value
// Works on tokens, so code is still checked after a parser error
// ###################
const codeBlocks = (tokens) => {
	const out = [];
	let depth = 0;
	let tag = null;
	let key = null;
	const near = (i, step) => {
		for (let j = i + step; j >= 0 && j < tokens.length; j += step) if (tokens[j].type !== "WHITESPACE") return tokens[j];
		return null;
	};
	tokens.forEach((t, i) => {
		if (t.type === "OPEN_BRACKET") {
			const name = near(i, 1);
			if (name?.type === "END_KEYWORD") depth = Math.max(0, depth - 1);
			else if (name) (tag = name.value), (key = null);
		} else if (t.type === "CLOSE_BRACKET" && tag !== null) {
			if (near(i, -1)?.type !== "EXCLAMATION_MARK" && tag !== "import") depth++;
			tag = null;
		} else if (t.type === "KEY") {
			key = t.value;
		} else if (t.type === "LOGIC") {
			const runtime = near(i - 1, -1)?.type === "RUNTIME_KEYWORD";
			const inProps = tag !== null;
			const where = !inProps ? "in markup" : tag === "for-each" ? "for [for-each]" : key ? `for "${key}" on [${tag}]` : `on [${tag}]`;
			const place = inProps ? (runtime ? "live" : "prop") : runtime && depth > 0 ? "live" : "block";
			out.push({ code: t.value, from: t.from, kind: runtime ? "runtime" : "build", place, where });
		}
	});
	return out;
};

// ###################
// The last ( [ { or template that is never closed, for "the code ends too early"
// ###################
const unclosed = (code) => {
	const stack = [];
	let at = 0;
	for (const t of jsTokens(code)) {
		if (t.type === "Punctuator" && "([{".includes(t.value)) stack.push({ at, char: t.value });
		else if (t.type === "Punctuator" && ")]}".includes(t.value)) stack.pop();
		else if (t.type === "TemplateHead") stack.push({ at, char: "`" });
		else if (t.type === "TemplateTail" && !t.closed) return stack.at(-1) ?? null;
		else if (t.type === "TemplateTail") stack.pop();
		else if (t.type === "NoSubstitutionTemplate" && !t.closed) return { at, char: "`" };
		at += t.value.length;
	}
	return stack.at(-1) ?? null;
};

const NAMES = { "(": "(", "[": "[", "{": "{", "`": "template string" };

const KEYWORDS = ["const", "let", "var", "function", "return", "import", "export", "async", "await", "class", "if", "else", "for", "while", "switch", "throw", "try", "catch", "typeof", "new"];

// ###################
// "cosnt a = 1": the word before the error looks like a keyword
// ###################
const typo = (code, pos) => {
	const before = /([A-Za-z]+)\s+$/.exec(code.slice(0, pos));
	if (!before || KEYWORDS.includes(before[1])) return null;
	const best = closest(before[1], KEYWORDS);
	return best ? { at: before.index, word: best } : null;
};

// ###################
// acorn's error → a diagnostic; "unexpected end" points at what was left open
// ###################
const syntaxError = (src, block, err) => {
	if (err.pos >= block.code.trimEnd().length || /^Unterminated template/.test(err.message)) {
		const open = unclosed(block.code);
		if (open) {
			return { ...rangeAt(src, block.from + open.at), severity: "error", source: "JavaScript", message: `this ${NAMES[open.char]} is never closed` };
		}
	}
	const end = block.code.trimEnd().length;
	if (err.pos >= end) {
		return { ...rangeAt(src, block.from + Math.max(0, end - 1)), severity: "error", source: "JavaScript", message: "the code ends too early" };
	}
	const message = err.message.replace(/ \(\d+:\d+\)$/, "");
	const fix = typo(block.code, err.pos);
	if (fix) return { ...rangeAt(src, block.from + fix.at), severity: "error", source: "JavaScript", message: `${message} (did you mean "${fix.word}"?)` };
	return { ...rangeAt(src, Math.min(block.from + err.pos, src.length)), severity: "error", source: "JavaScript", message };
};

// ###################
// Parse one block like the compiler: one expression if it is one, else statements
// ###################
const parseBlock = (src, block, out) => {
	try {
		const tree = acorn.parse(`(${block.code}\n)`, ACORN);
		if (tree.body.length === 1 && tree.body[0].type === "ExpressionStatement") return { tree, shift: -1 };
	} catch {}
	if (block.place === "live") {
		const lead = /^\s*/.exec(block.code)[0].length;
		out.push({
			...lineRange(src, block.from + lead, block.from + block.code.trimEnd().length),
			severity: "error",
			source: "ArcMoon",
			message: `runtime \${ }$ ${block.where} must be one expression (a live value). To run statements, move this runtime \${ }$ to the top level of the file.`
		});
		return null;
	}
	try {
		return { tree: acorn.parse(block.code, ACORN), shift: 0 };
	} catch (err) {
		out.push(syntaxError(src, block, err));
		return null;
	}
};

// ###################
// Walk acorn nodes; inner functions are skipped where a rule is about this block only
// ###################
const walk = (node, visit, skipFunctions = false) => {
	if (!node || typeof node.type !== "string") return;
	visit(node);
	if (skipFunctions && /Function/.test(node.type)) return;
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) value.forEach((v) => walk(v, visit, skipFunctions));
		else if (value && typeof value.type === "string") walk(value, visit, skipFunctions);
	}
};

const isArcMoonCall = (n, names) =>
	n.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.object.name === "ArcMoon" && names.includes(n.callee.property.name);

// ###################
// ArcMoon's rules for code, from the compiler and ArcMoon-LSP
// (rules that need the whole project, like bundle in arcmoon.config.js, are left to the LSP)
// ###################
const checkRules = (src, block, { tree, shift }, out) => {
	const at = (node, end = node.end) => lineRange(src, block.from + node.start + shift, block.from + end + shift);
	const error = (node, message, end) => out.push({ ...at(node, end), severity: "error", source: "ArcMoon", message });
	const statements = shift ? [] : tree.body;

	if (block.kind === "build") {
		walk(tree, (n) => {
			if (n.type === "ReturnStatement" && n !== statements.at(-1)) error(n, "return is only allowed as the last statement of ${ }$");
			if (isArcMoonCall(n, ["defineRef", "ref", "refs"])) error(n, `ArcMoon.${n.callee.property.name}() only works in runtime code`);
		}, true);
		for (const s of statements) {
			if (s.type === "ImportDeclaration" && block.place === "prop") error(s, "import is only allowed in a ${ }$ block, not in a prop value");
			if (s.type === "ExportNamedDeclaration") {
				if (block.place === "prop") error(s, "export is only allowed in a ${ }$ block");
				else if (s.source) error(s, "export ... from is not supported in ${ }$");
			}
			if (s.type === "ExportDefaultDeclaration" || s.type === "ExportAllDeclaration") error(s, "only named exports are allowed in ${ }$");
		}
		return;
	}

	for (const s of statements) {
		if (/^Export/.test(s.type)) error(s, "export is not allowed in runtime code");
		if (s.type !== "ImportDeclaration") continue;
		const spec = s.source.value;
		const name = spec.startsWith("@") ? spec : spec.split("/")[0];
		if (spec.startsWith("node:") || NODE.has(name)) error(s.source, `runtime import "${spec}" is a Node.js module, which doesn't exist in the browser`);
	}
	walk(tree, (n) => {
		if (!isArcMoonCall(n, ["defineRef"])) return;
		const arg = n.arguments[0];
		if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") error(n, "ArcMoon.defineRef() needs a quoted name");
	});
};

const checkCode = (src, tokens, out, rules) => {
	for (const block of codeBlocks(tokens)) {
		const parsed = parseBlock(src, block, out);
		if (parsed && rules) checkRules(src, block, parsed, out);
	}
};

const withText = (src, tokens) => {
	const at = offsets(src);
	return tokens.filter((t) => t.type !== "EOF").map((t) => ({ ...t, from: at(t.range.start) }));
};

// ###################
// "logic block is not closed": often the JS inside is what's wrong
// (an open string or { reads past }$). Check the code up to the next }$ first
// ###################
const openLogic = (src, err, out, rules) => {
	const start = offsets(src)(err.position);
	const open = src.indexOf("${", start);
	const close = src.indexOf("}$", open + 2);
	let head = [];
	try {
		head = withText(src, lexer(src.slice(0, start)));
	} catch {}
	checkCode(src, head, out, rules);
	if (open === -1 || close === -1) return false;

	const runtime = /runtime\s*$/.test(src.slice(start, open)) || src.slice(start, open).trim() === "runtime";
	const code = src.slice(open + 2, close);
	const tokens = [...head, ...(runtime ? [{ type: "RUNTIME_KEYWORD", value: "runtime", from: start }] : []), { type: "LOGIC_OPEN", value: "${", from: open }, { type: "LOGIC", value: code, from: open + 2 }];
	const before = out.length;
	checkCode(src, tokens, out, false);
	return out.slice(before).some((d) => d.source === "JavaScript");
};

const find = (src, rules) => {
	const out = [];
	let tokens;
	try {
		tokens = withText(src, lexer(src));
	} catch (err) {
		const found = /logic block is not closed/.test(err.message) && openLogic(src, err, out, rules);
		if (!found) {
			if (!/logic block is not closed/.test(err.message)) {
				try {
					checkCode(src, withText(src, lexer(src.slice(0, offsets(src)(err.position)))), out, rules);
				} catch {}
			}
			out.unshift({ ...rangeAt(src, err.position ? offsets(src)(err.position) : 0), severity: "error", source: "ArcMoon", message: arcmoonMessage(err) });
		}
		return out;
	}
	try {
		parser(lexer(src));
	} catch (err) {
		out.push({ ...rangeAt(src, err.position ? offsets(src)(err.position) : 0), severity: "error", source: "ArcMoon", message: arcmoonMessage(err) });
	}
	checkCode(src, tokens, out, rules);
	return out;
};

// ###################
// Sorted, with line, column and the underlined text
// ###################
export function diagnose(src, { rules = true } = {}) {
	return find(src, rules)
		.sort((a, b) => a.from - b.from)
		.map((d) => {
			const lines = src.slice(0, d.from).split("\n");
			return { from: d.from, to: d.to, line: lines.length, column: lines.at(-1).length + 1, text: src.slice(d.from, d.to), severity: d.severity, source: d.source, message: d.message };
		});
}
