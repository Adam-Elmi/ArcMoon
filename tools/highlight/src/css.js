// ###################
// CSS inside [style] … [end]: where it is, its tokens for highlighting, and its braces
// The body is TEXT tokens with ${ }$ blocks between them; for CSS, each ${ }$ (and a
// runtime before it) becomes a placeholder of the same length, so offsets stay the source's
// ###################

// ###################
// [style]…[end] regions: { start, end } token indexes of the body, { from, to } source offsets
// [style = … !] has no body; [style] with no [end] runs to the end of the file
// ###################
export function cssRegions(tokens) {
	const regions = [];
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type !== "OPEN_BRACKET" || tokens[i + 1]?.type !== "IDENTIFIER" || tokens[i + 1].value !== "style") continue;
		let j = i + 2;
		while (j < tokens.length && tokens[j].type !== "CLOSE_BRACKET") j++;
		if (j >= tokens.length) break;
		let prev = j - 1;
		while (prev > i && tokens[prev].type === "WHITESPACE") prev--;
		if (tokens[prev].type === "EXCLAMATION_MARK") continue;
		let k = j + 1;
		while (k < tokens.length && !(tokens[k].type === "OPEN_BRACKET" && tokens[k + 1]?.type === "END_KEYWORD")) k++;
		if (k > j + 1) regions.push({ start: j + 1, end: k, from: tokens[j + 1].from, to: tokens[k - 1].to });
		i = k;
	}
	return regions;
}

// ###################
// The region's CSS, with each ${ }$ replaced: "0"s before a unit (${ w }$px → 000px), else "_"
// holes: the replaced ranges, as source offsets
// ###################
export function cssText(src, tokens, region) {
	// whitespace between runtime and ${ belongs to the ${ }$; other whitespace is CSS
	const textual = (k) => {
		const t = tokens[k];
		return t.type === "TEXT" || t.type === "ESCAPE" || (t.type === "WHITESPACE" && tokens[k - 1]?.type !== "RUNTIME_KEYWORD");
	};
	let text = "";
	const holes = [];
	let i = region.start;
	while (i < region.end) {
		if (textual(i)) {
			text += tokens[i].value;
			i++;
			continue;
		}
		// ###################
		// One ${ }$ (with runtime before it) is one hole, filled as a whole
		// ###################
		const from = tokens[i].from;
		while (i < region.end && !textual(i)) i++;
		const to = tokens[i - 1].to;
		const fill = /[a-z%]/i.test(src[to] ?? "") ? "0" : "_";
		text += fill.repeat(to - from);
		holes.push([from, to]);
	}
	return { text, holes };
}

// ###################
// CSS tokens: { from, to, type } with types CSS_COMMENT, CSS_STRING, CSS_AT_RULE, CSS_SELECTOR,
// CSS_CLASS, CSS_ID, CSS_PSEUDO, CSS_ATTRIBUTE, CSS_PROPERTY, CSS_VARIABLE, CSS_VALUE, CSS_NUMBER,
// CSS_COLOR, CSS_FUNCTION, CSS_IMPORTANT, CSS_PUNCTUATION. Offsets are in text.
// Each statement is read to its end ({, ; or }): before { it's a selector (or an @rule's prelude),
// otherwise a declaration (property: value)
// ###################
const NAME = /[\w-]/;

export function tokenizeCss(text) {
	const out = [];
	const push = (from, to, type) => to > from && out.push({ from, to, type });
	let i = 0;

	// ###################
	// Strings and comments first, wherever they are
	// ###################
	const skipped = (at) => {
		if (text.startsWith("/*", at)) {
			const end = text.indexOf("*/", at + 2);
			const to = end === -1 ? text.length : end + 2;
			push(at, to, "CSS_COMMENT");
			return to;
		}
		const q = text[at];
		if (q === '"' || q === "'") {
			let j = at + 1;
			while (j < text.length && text[j] !== q && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
			const to = Math.min(j + 1, text.length);
			push(at, to, "CSS_STRING");
			return to;
		}
		return -1;
	};

	// ###################
	// Where this statement ends: the first { ; or } outside strings, comments and ( )
	// ###################
	const statementEnd = (from) => {
		let depth = 0;
		for (let j = from; j < text.length; j++) {
			if (text.startsWith("/*", j)) {
				const end = text.indexOf("*/", j + 2);
				j = end === -1 ? text.length : end + 1;
				continue;
			}
			const c = text[j];
			if (c === '"' || c === "'") {
				let k = j + 1;
				while (k < text.length && text[k] !== c && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
				j = k;
				continue;
			}
			if (c === "(") depth++;
			else if (c === ")") depth = Math.max(0, depth - 1);
			else if (depth === 0 && (c === "{" || c === ";" || c === "}")) return j;
		}
		return text.length;
	};

	const selector = (from, to) => {
		let j = from;
		while (j < to) {
			const s = skipped(j);
			if (s !== -1) {
				j = s;
				continue;
			}
			const c = text[j];
			if (c === "." && NAME.test(text[j + 1] ?? "")) {
				let k = j + 1;
				while (k < to && NAME.test(text[k])) k++;
				push(j, k, "CSS_CLASS");
				j = k;
			} else if (c === "#" && NAME.test(text[j + 1] ?? "")) {
				let k = j + 1;
				while (k < to && NAME.test(text[k])) k++;
				push(j, k, "CSS_ID");
				j = k;
			} else if (c === ":") {
				let k = j + 1;
				if (text[k] === ":") k++;
				while (k < to && NAME.test(text[k])) k++;
				push(j, k, "CSS_PSEUDO");
				j = k;
			} else if (c === "[") {
				const end = text.indexOf("]", j);
				const k = end === -1 || end > to ? to : end + 1;
				push(j, k, "CSS_ATTRIBUTE");
				j = k;
			} else if (NAME.test(c) || c === "*") {
				let k = j + 1;
				while (k < to && NAME.test(text[k])) k++;
				push(j, k, "CSS_SELECTOR");
				j = k;
			} else {
				if (/[>+~,&()]/.test(c)) push(j, j + 1, "CSS_PUNCTUATION");
				j++;
			}
		}
	};

	const value = (from, to) => {
		let j = from;
		while (j < to) {
			const s = skipped(j);
			if (s !== -1) {
				j = s;
				continue;
			}
			const rest = text.slice(j, to);
			let m;
			if ((m = /^!\s*important\b/i.exec(rest))) push(j, j + m[0].length, "CSS_IMPORTANT"), (j += m[0].length);
			else if ((m = /^#[0-9a-f]{3,8}\b/i.exec(rest))) push(j, j + m[0].length, "CSS_COLOR"), (j += m[0].length);
			else if ((m = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(%|[a-z]+)?/i.exec(rest)) && !NAME.test(text[j - 1] ?? "")) push(j, j + m[0].length, "CSS_NUMBER"), (j += m[0].length);
			else if ((m = /^--[\w-]+/.exec(rest))) push(j, j + m[0].length, "CSS_VARIABLE"), (j += m[0].length);
			else if ((m = /^-?[a-z_][\w-]*(?=\()/i.exec(rest))) push(j, j + m[0].length, "CSS_FUNCTION"), (j += m[0].length);
			else if ((m = /^-?[a-z_][\w-]*/i.exec(rest))) push(j, j + m[0].length, "CSS_VALUE"), (j += m[0].length);
			else {
				if (/[,/():]/.test(text[j])) push(j, j + 1, "CSS_PUNCTUATION");
				j++;
			}
		}
	};

	while (i < text.length) {
		const s = skipped(i);
		if (s !== -1) {
			i = s;
			continue;
		}
		if (/\s/.test(text[i])) {
			i++;
			continue;
		}
		if (text[i] === "}" || text[i] === ";") {
			push(i, i + 1, "CSS_PUNCTUATION");
			i++;
			continue;
		}
		const end = statementEnd(i);
		if (text[i] === "@") {
			let k = i + 1;
			while (k < end && NAME.test(text[k])) k++;
			push(i, k, "CSS_AT_RULE");
			value(k, end);
		} else if (text[end] === "{") {
			selector(i, end);
		} else {
			// ###################
			// property: value (a colon at the top level splits them)
			// ###################
			const colon = text.slice(i, end).search(/:/);
			if (colon === -1) value(i, end);
			else {
				const name = text.slice(i, i + colon).trim();
				const at = text.indexOf(name, i);
				push(at, at + name.length, name.startsWith("--") ? "CSS_VARIABLE" : "CSS_PROPERTY");
				push(i + colon, i + colon + 1, "CSS_PUNCTUATION");
				value(i + colon + 1, end);
			}
		}
		if (end < text.length) push(end, end + 1, "CSS_PUNCTUATION");
		i = end + 1;
	}
	return out.sort((a, b) => a.from - b.from);
}

// ###################
// A CSS value alone (css.color: "red"): read as the value of a declaration
// ###################
export function tokenizeCssValue(text) {
	return tokenizeCss(`a:${text}`)
		.filter((t) => t.from >= 2)
		.map((t) => ({ ...t, from: t.from - 2, to: t.to - 2 }));
}

// ###################
// CSS in props: style: "…" (declarations), css.name: "…" and --name: "…" (one value).
// → [{ kind, key, name, keyFrom, keyTo, from, to }]: from / to are the string's inside, without its quotes
// ###################
export function propCss(tokens) {
	const out = [];
	for (let i = 0; i < tokens.length; i++) {
		const key = tokens[i];
		if (key.type !== "KEY") continue;
		const name = key.value.replace(/^["']|["']$/g, "");
		const kind = name === "style" ? "declarations" : name.startsWith("css.") || name.startsWith("--") ? "value" : null;
		if (!kind) continue;
		let j = i + 1;
		while (tokens[j]?.type === "WHITESPACE") j++;
		if (tokens[j]?.type !== "COLON") continue;
		j++;
		while (tokens[j]?.type === "WHITESPACE") j++;
		const value = tokens[j];
		if (value?.type !== "STRING" || value.value.length < 2) continue;
		out.push({ kind, key: name, name: name.startsWith("css.") ? name.slice(4) : name, token: j, keyFrom: key.from, keyTo: key.to, from: value.from + 1, to: value.to - 1 });
	}
	return out;
}

// ###################
// CSS tokens for a whole file, as source offsets. A token is cut where a ${ }$ is:
// in ${ w }$px only "px" is CSS (the ${ }$ keeps its own colors)
// ###################
export function cssTokens(src, tokens) {
	const out = [];
	for (const region of cssRegions(tokens)) {
		const { text, holes } = cssText(src, tokens, region);
		for (const t of tokenizeCss(text)) {
			let parts = [[region.from + t.from, region.from + t.to]];
			for (const [a, b] of holes) parts = parts.flatMap(([from, to]) => (to <= a || from >= b ? [[from, to]] : [[from, a], [b, to]].filter(([x, y]) => y > x)));
			for (const [from, to] of parts) out.push({ type: t.type, from, to, value: src.slice(from, to) });
		}
	}
	return out;
}

// ###################
// tokens with each TEXT token in a [style] body split into its CSS tokens
// (what isn't a CSS token stays WHITESPACE, or CSS_TEXT)
// ###################
export function withCss(src, tokens) {
	const props = propCss(tokens);
	const css = [...cssTokens(src, tokens), ...props.flatMap((p) => (p.kind === "declarations" ? tokenizeCss : tokenizeCssValue)(src.slice(p.from, p.to)).map((t) => ({ ...t, from: p.from + t.from, to: p.from + t.to })))].sort((a, b) => a.from - b.from);
	if (!css.length) return tokens;
	const propTokens = new Set(props.map((p) => p.token));
	const inStyle = new Set(cssRegions(tokens).flatMap((r) => Array.from({ length: r.end - r.start }, (_, k) => r.start + k)));
	const out = [];
	let c = 0;
	tokens.forEach((t, i) => {
		// ###################
		// A CSS prop's string: its quotes stay STRING, the inside is CSS
		// ###################
		if (propTokens.has(i)) {
			out.push({ type: "STRING", value: t.value[0], from: t.from, to: t.from + 1 });
			const inner = { ...t, from: t.from + 1, to: t.to - 1 };
			splitInto(inner);
			out.push({ type: "STRING", value: t.value.at(-1), from: t.to - 1, to: t.to });
			return;
		}
		if (t.type !== "TEXT" || !inStyle.has(i)) return out.push(t);
		splitInto(t);
	});
	return out;

	function splitInto(t) {
		let at = t.from;
		const gap = (to) => {
			if (to <= at) return;
			const value = src.slice(at, to);
			out.push({ type: /^\s+$/.test(value) ? "WHITESPACE" : "CSS_TEXT", value, from: at, to });
		};
		while (c < css.length && css[c].to <= t.from) c++;
		for (let k = c; k < css.length && css[k].from < t.to; k++) {
			const from = Math.max(css[k].from, t.from);
			const to = Math.min(css[k].to, t.to);
			gap(from);
			out.push({ type: css[k].type, value: src.slice(from, to), from, to });
			at = to;
		}
		gap(t.to);
	}
}

// ###################
// Statements inside a block with no colon (.a { color }): → [{ at, to }] (offsets in text).
// depth: 1 when the text is already inside a block (a style: string)
// ###################
export function missingColons(text, depth = 0) {
	const out = [];
	let start = 0;
	let parens = 0;
	const check = (end) => {
		// comments are left out (blanked to the same length, so offsets stay)
		const piece = text.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length));
		const body = piece.trim();
		if (depth > 0 && body && !body.startsWith("@") && !/^[_0\s]+$/.test(body) && !body.includes(":")) {
			const at = start + piece.indexOf(body);
			out.push({ at, to: at + body.length });
		}
	};
	for (let j = 0; j < text.length; j++) {
		if (text.startsWith("/*", j)) {
			const end = text.indexOf("*/", j + 2);
			j = end === -1 ? text.length : end + 1;
			continue;
		}
		const c = text[j];
		if (c === '"' || c === "'") {
			let k = j + 1;
			while (k < text.length && text[k] !== c && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
			j = k;
			continue;
		}
		if (c === "(") parens++;
		else if (c === ")") parens = Math.max(0, parens - 1);
		if (parens) continue;
		if (c === "{") {
			depth++;
			start = j + 1;
		} else if (c === ";" || c === "}") {
			check(j);
			if (c === "}") depth = Math.max(0, depth - 1);
			start = j + 1;
		}
	}
	check(text.length);
	return out;
}

// ###################
// Braces that don't pair up: { never closed, or } with no {. → [{ at, message }] (offsets in text)
// ###################
export function unbalanced(text) {
	const open = [];
	const out = [];
	for (let j = 0; j < text.length; j++) {
		if (text.startsWith("/*", j)) {
			const end = text.indexOf("*/", j + 2);
			if (end === -1) {
				out.push({ at: j, message: "this comment is never closed (*/)" });
				break;
			}
			j = end + 1;
			continue;
		}
		const c = text[j];
		if (c === '"' || c === "'") {
			let k = j + 1;
			while (k < text.length && text[k] !== c && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
			if (text[k] !== c) out.push({ at: j, message: "this string is never closed" });
			j = k;
			continue;
		}
		if (c === "{") open.push(j);
		else if (c === "}") {
			if (open.length) open.pop();
			else out.push({ at: j, message: "this } has no { to close" });
		}
	}
	for (const at of open) out.push({ at, message: "this { is never closed" });
	return out.sort((a, b) => a.at - b.at);
}
