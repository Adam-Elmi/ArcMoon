// ###################
// ArcMoon tokens with their exact text from the source
// (the lexer drops quotes, "#" and "\" from some values; highlighting needs the text as written)
// ###################

import lexer from "../../../core/lexer.js";

const offsets = (src) => {
	const starts = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
	return ({ line, character }) => Math.min((starts[line] ?? src.length) + character, src.length);
};

const fromLexer = (src) => {
	const at = offsets(src);
	const out = [];
	for (const t of lexer(src)) {
		if (t.type === "EOF") break;
		const from = at(t.range.start);
		const to = at(t.range.end);
		if (to > from) out.push({ type: t.type, value: src.slice(from, to), from, to });
	}
	return out;
};

// ###################
// Never throws: half-written code (an open string, an open ${) is
// highlighted up to the error, and the rest is plain TEXT
// ###################
export default function tokenize(src) {
	try {
		return fromLexer(src);
	} catch (err) {
		const end = err.position ? offsets(src)(err.position) : 0;
		let head = [];
		try {
			head = fromLexer(src.slice(0, end));
		} catch {}
		const last = head.at(-1)?.to ?? 0;
		return last < src.length ? [...head, { type: "TEXT", value: src.slice(last), from: last, to: src.length }] : head;
	}
}
