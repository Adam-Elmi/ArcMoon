// ###################
// ArcMoon runtime prepare: refs, live values, exported values (no bundling)
// ###################

import * as acorn from "acorn";
import closest from "./suggest.js";

const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, locations: true };

export class RuntimeError extends Error {
	constructor(message, source, position) {
		const where = position ? `${source}:${position.line + 1}:${position.character + 1}` : source;
		super(`${where}  ${message}`);
		this.name = "RuntimeError";
		this.source = source;
		this.position = position;
	}
}

const LARGE_VALUE = 50 * 1024;
const isMarker = (v) => v !== null && typeof v === "object" && v.type === "runtime";
const siteKey = (m) => `${m.range.start.line}:${m.range.start.character}`;

// ###################
// Small AST walker with parent
// ###################
const walk = (node, visit, parent = null) => {
	if (!node || typeof node.type !== "string") return;
	visit(node, parent);
	for (const key of Object.keys(node)) {
		const child = node[key];
		if (Array.isArray(child)) child.forEach((c) => walk(c, visit, node));
		else if (child && typeof child.type === "string") walk(child, visit, node);
	}
};

const patternNames = (p, out) => {
	if (!p) return;
	if (p.type === "Identifier") out.add(p.name);
	else if (p.type === "ObjectPattern") p.properties.forEach((q) => patternNames(q.type === "RestElement" ? q.argument : q.value, out));
	else if (p.type === "ArrayPattern") p.elements.forEach((e) => patternNames(e, out));
	else if (p.type === "RestElement") patternNames(p.argument, out);
	else if (p.type === "AssignmentPattern") patternNames(p.left, out);
};

// ###################
// Every name declared anywhere in the code
// ###################
const declaredIn = (ast, out = new Set()) => {
	walk(ast, (n) => {
		if (n.type === "VariableDeclarator") patternNames(n.id, out);
		else if (/^(Function|Class)(Declaration|Expression)$/.test(n.type) && n.id) out.add(n.id.name);
		if (/Function/.test(n.type)) n.params.forEach((p) => patternNames(p, out));
		if (n.type === "CatchClause") patternNames(n.param, out);
		if (/^Import(Default|Namespace)?Specifier$/.test(n.type)) out.add(n.local.name);
	});
	return out;
};

// ###################
// Every name the code reads
// ###################
const referencedIn = (ast, out = new Set()) => {
	walk(ast, (n, p) => {
		if (n.type !== "Identifier" || !p) return;
		if (p.type === "MemberExpression" && p.property === n && !p.computed) return;
		if ((p.type === "Property" || p.type === "MethodDefinition" || p.type === "PropertyDefinition") && p.key === n && !p.computed && !p.shorthand) return;
		if (/Label|Break|Continue/.test(p.type)) return;
		if (/^(Import|Export)/.test(p.type)) return;
		out.add(n.name);
	});
	return out;
};

// ###################
// Values that can be copied into the bundle
// ###################
const toJS = (v, name, seen = new Set()) => {
	if (v === undefined) return "undefined";
	if (v !== null && typeof v === "object" && typeof v.__arcmUnsendable === "string") throw new Error(v.__arcmUnsendable);
	if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : v !== v ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
	if (typeof v === "bigint") return `${v}n`;
	if (typeof v === "function") throw new Error(`"${name}" is a function; functions can't be sent to the browser`);
	if (typeof v !== "object") throw new Error(`"${name}" can't be sent to the browser`);
	if (seen.has(v)) throw new Error(`"${name}" has a circular reference`);
	seen.add(v);
	let out;
	if (Array.isArray(v)) out = `[${v.map((x) => toJS(x, name, seen)).join(",")}]`;
	else if (v instanceof Date) out = `new Date(${v.getTime()})`;
	else if (v instanceof Map) out = `new Map([${[...v].map(([a, b]) => `[${toJS(a, name, seen)},${toJS(b, name, seen)}]`).join(",")}])`;
	else if (v instanceof Set) out = `new Set([${[...v].map((x) => toJS(x, name, seen)).join(",")}])`;
	else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
		out = `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${toJS(x, name, seen)}`).join(",")}}`;
	} else {
		throw new Error(`"${name}" is a ${v.constructor?.name ?? "class"} instance; only plain values can be sent to the browser`);
	}
	seen.delete(v);
	return out;
};

const fileName = (id) => id.split(/[\\/]/).pop();

const suggest = (name, names) => {
	const best = closest(name, names);
	return best ? ` (did you mean "${best}"?)` : "";
};

// ###################
// The same check, for the build worker: an error message, or null when the value can go to the browser
// ###################
export const unsendable = (v, name) => {
	try {
		toJS(v, name);
		return null;
	} catch (err) {
		return err.message;
	}
};

// ###################
// Prepare the page's runtime code; changes the tree in place
// hasCode is false when the page has no runtime code
// ###################
// ###################
// Inline source map: each runtime line points at its line in the .arcm file
// A mapping at every word, so columns stay right too
// ###################
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const vlq = (n) => {
	let v = n < 0 ? (-n << 1) | 1 : n << 1;
	let out = "";
	do {
		let digit = v & 31;
		v >>>= 5;
		if (v) digit |= 32;
		out += B64[digit];
	} while (v);
	return out;
};
const base64 = (text) => {
	let bin = "";
	for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
	return btoa(bin);
};

const sourceMap = (lines, mapped, id, src) => {
	const mappings = [];
	let last = { line: 0, col: 0 };
	for (const [index, block] of lines.entries()) {
		const m = mapped.find((x) => x.line === index);
		for (const [k, text] of block.split("\n").entries()) {
			const segs = [];
			if (m) {
				const offset = k === 0 ? m.column : 0;
				const line = m.start.line + k;
				const shift = (k === 0 ? m.start.character : 0) - offset;
				let gen = 0;
				for (const w of text.matchAll(/[\w$]+|\S/g)) {
					if (w.index < offset) continue;
					segs.push(vlq(w.index - gen) + vlq(0) + vlq(line - last.line) + vlq(shift + w.index - last.col));
					gen = w.index;
					last = { line, col: shift + w.index };
				}
			}
			mappings.push(segs.join(","));
		}
	}
	const json = { version: 3, sources: [id], ...(src ? { sourcesContent: [src] } : {}), names: [], mappings: mappings.join(";") };
	return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64(JSON.stringify(json))}`;
};

export default function prepareRuntime(result) {
	const { tree, uses, modules } = result;
	const warnings = [];

	const scripts = [];
	const perUse = uses.map((u) => ({ ...u, blocks: new Map(), live: new Map(), attached: new Map(), children: [] }));
	for (const u of perUse) if (u.parent !== null) perUse[u.parent].children.push(u.id);

	let elementCount = 0;
	const initialTargets = [];
	const styles = [];

	const addLive = (marker, target) => {
		const u = perUse[marker.use];
		const key = siteKey(marker);
		if (!u.live.has(key)) u.live.set(key, { marker, targets: [] });
		u.live.get(key).targets.push(target);
		return target;
	};

	// ###################
	// 1. Walk the tree: take out blocks, mark live values and refs
	// ###################
	const visit = (children, parentTag) => {
		for (let k = 0; k < children.length; k++) {
			const node = children[k];

			if (node.type === "runtime") {
				if (node.kind === "block") {
					perUse[node.use].blocks.set(siteKey(node), node);
					children.splice(k--, 1);
				} else {
					const id = `t${elementCount++}`;
					const text = { type: "text", value: "" };
					node.where = parentTag ? `inside [${parentTag}]` : "in markup";
					children.splice(k, 1, { type: "comment", value: `arcm:${id}` }, text, { type: "comment", value: "/arcm" });
					k += 2;
					initialTargets.push({ marker: node, text, target: addLive(node, { id, text: true }) });
				}
				continue;
			}

			if (node.type !== "element") continue;

			// ###################
			// [script = src: "./app.js"] with a local file joins the page's bundle
			// ###################
			const src = node.properties.src;
			if (node.tagName.toLowerCase() === "script" && typeof src === "string" && !/^([a-z][a-z\d+.-]*:|\/\/)/i.test(src)) {
				scripts.push({ src, source: node.data.source, position: node.data.position });
				children.splice(k--, 1);
				continue;
			}

			const { directives } = node.data;
			const u = perUse[node.data.use];
			const refName = directives.ref ?? directives["shared-ref"];
			const shared = directives["shared-ref"] !== undefined;

			if (directives.ref !== undefined && directives["shared-ref"] !== undefined) {
				throw new RuntimeError(`[${node.tagName}] can't have both arcm-ref and arcm-shared-ref`, node.data.source ?? u.module, node.data.position);
			}
			if (refName !== undefined) {
				if (typeof refName !== "string" || !refName) {
					throw new RuntimeError(`arcm-ref on [${node.tagName}] must be a quoted name`, node.data.source ?? u.module, node.data.position);
				}
				const seen = u.attached.get(refName);
				if (seen && (!shared || !seen.shared)) {
					throw new RuntimeError(`single ref "${refName}" is attached to 2 elements; use arcm-shared-ref`, node.data.source ?? u.module, node.data.position);
				}
				if (!seen) u.attached.set(refName, { name: refName, id: `${refName}-u${u.id}`, shared, used: false });
				node.properties["data-arcm-ref"] = u.attached.get(refName).id;
			}

			for (const [key, value] of Object.entries(node.properties)) {
				if (!isMarker(value)) continue;
				// ###################
				// The browser's setAttribute refuses these names; say so at build time
				// ###################
				if (!key || /[\s"'>/=\x00-\x1f\x7f]/.test(key)) {
					const what = key ? `can't contain spaces, quotes, ">", "/", "=" or control characters` : "can't be empty";
					throw new RuntimeError(`${JSON.stringify(key)} on [${node.tagName}] is not a valid attribute name: it ${what}`, node.data.source ?? u.module, node.data.position);
				}
				delete node.properties[key];
				value.where = `for "${key}" on [${node.tagName}]`;
				node.properties["data-arcm-ref"] ??= `e${elementCount++}`;
				const target = addLive(value, { id: node.properties["data-arcm-ref"], attr: key });
				initialTargets.push({ marker: value, element: node, key, target });
			}

			// ###################
			// Live text in a page [style]: the client rebuilds the whole CSS text
			// ###################
			if (node.tagName.toLowerCase() === "style" && node.children.some((c) => c.type === "runtime")) {
				const id = (node.properties["data-arcm-ref"] ??= `e${elementCount++}`);
				node.children = node.children.map((c, part) => {
					if (c.type !== "runtime") return c;
					c.where = "inside [style]";
					const text = { type: "text", value: "" };
					initialTargets.push({ marker: c, text, target: addLive(c, { id, text: true, part }) });
					return text;
				});
				styles.push({ node, u, id });
				continue;
			}

			visit(node.children, node.tagName);
		}
	};
	visit(tree.children, null);

	// ###################
	// 2. Per file: parse runtime code once
	// ###################
	const files = new Map();
	const fileOf = (id) => {
		if (files.has(id)) return files.get(id);
		const blocks = new Map();
		const sites = new Map();
		for (const u of perUse) {
			if (u.module !== id) continue;
			for (const [k, b] of u.blocks) blocks.set(k, b);
			for (const [k, s] of u.live) sites.set(k, s.marker);
		}
		const f = { id, blocks: [...blocks.values()], sites: [...sites.entries()], parsed: null };
		files.set(id, f);
		return f;
	};

	// ###################
	// A position inside runtime code; live values are parsed as "(code)", one column to the right
	// ###################
	const at = (marker, loc, live = false) => {
		const start = marker.codeStart ?? marker.range.start;
		if (!loc) return start;
		return {
			line: start.line + loc.line - 1,
			character: loc.line === 1 ? start.character + loc.column - (live ? 1 : 0) : loc.column
		};
	};

	const parseFile = (f) => {
		const info = modules.get(f.id) ?? { staticNames: new Set(), exportNames: new Set(), loopNames: new Set() };
		const hoisted = new Set();
		const importAt = new Map();
		const usedAt = new Map();
		const declared = new Set();
		const refsDefined = new Map();
		const refCalls = [];
		const signals = new Map();
		const bodies = [];
		const lives = [];

		const scan = (ast, marker, live = false) => {
			walk(ast, (n, p) => {
				const isArc = (name) => n.type === "CallExpression" && n.callee.type === "MemberExpression" &&
					n.callee.object.name === "ArcMoon" && n.callee.property.name === name;
				if (isArc("defineRef")) {
					const arg = n.arguments[0];
					if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") {
						throw new RuntimeError("ArcMoon.defineRef() needs a quoted name", f.id, at(marker, n.loc.start, live));
					}
					refsDefined.set(arg.value, at(marker, n.loc.start, live));
					if (p?.type === "VariableDeclarator" && p.id.type === "Identifier") refCalls.push({ bind: p.id.name, name: arg.value });
				}
				for (const fn of ["ref", "refs"]) {
					if (!isArc(fn)) continue;
					const arg = n.arguments[0];
					let name = null;
					if (arg?.type === "CallExpression" && arg.arguments[0]?.type === "Literal") name = arg.arguments[0].value;
					else if (arg?.type === "Identifier") name = { bind: arg.name };
					refCalls.push({ fn, name, pos: at(marker, n.loc.start, live) });
				}
			});
		};

		for (const b of f.blocks) {
			let ast;
			try {
				ast = acorn.parse(b.code, ACORN);
			} catch (err) {
				throw new RuntimeError(`SyntaxError: ${err.message.replace(/ \(\d+:\d+\)$/, "")}`, f.id, at(b, err.loc));
			}
			let code = b.code;
			const edits = [];
			for (const s of ast.body) {
				if (s.type === "ImportDeclaration") {
					hoisted.add(b.code.slice(s.start, s.end));
					if (!importAt.has(s.source.value)) importAt.set(s.source.value, at(b, s.source.loc.start));
					edits.push(s);
				} else if (/^Export/.test(s.type)) {
					throw new RuntimeError("export is not allowed in runtime code", f.id, at(b, s.loc.start));
				} else if (s.type === "VariableDeclaration") {
					for (const d of s.declarations) {
						const init = d.init;
						if (d.id.type === "Identifier" && init?.type === "CallExpression" && init.callee.name === "signal" && init.arguments.length === 1) {
							const a = init.arguments[0];
							if (a.type === "Literal" && !a.regex) signals.set(d.id.name, { value: a.value });
							else if (a.type === "Identifier") signals.set(d.id.name, { from: a.name });
						}
					}
				}
			}
			for (const s of edits.reverse()) code = code.slice(0, s.start) + code.slice(s.start, s.end).replace(/[^\n]/g, " ") + code.slice(s.end);
			declaredIn(ast, declared);
			scan(ast, b);
			bodies.push({ code, ast, marker: b });
		}

		f.sites.forEach(([key, marker], index) => {
			let ast;
			try {
				ast = acorn.parse(`(${marker.code}\n)`, ACORN);
			} catch (err) {
				throw new RuntimeError(
					`runtime \${ }$ ${marker.where ?? "in markup"} must be one expression (a live value).\n  To run statements, move this runtime \${ }$ to the top level of the file.`,
					f.id,
					at(marker)
				);
			}
			scan(ast, marker, true);
			lives.push({ key, index, marker, ast, expr: ast.body[0].expression });
		});

		// ###################
		// Compile-time names used here must be exported
		// ###################
		const used = new Set();
		for (const x of [...bodies, ...lives]) referencedIn(x.ast, used);
		// ###################
		// Where each name is first used, for exact error positions
		// ###################
		const usedIn = new Map();
		for (const x of [...bodies, ...lives]) {
			walk(x.ast, (n) => {
				if (n.type === "Identifier" && used.has(n.name) && !usedAt.has(n.name)) {
					usedAt.set(n.name, at(x.marker, n.loc.start, lives.includes(x)));
					usedIn.set(n.name, x.marker);
				}
			});
		}
		// ###################
		// "The runtime ${ x }$" in text: maybe the word "runtime" was meant
		// ###################
		const wordHint = (name) => (usedIn.get(name)?.afterWord ? ` If you meant the word "runtime" before a build-time value, write \\runtime \${ … }$.` : "");

		const values = [];
		for (const name of used) {
			if (declared.has(name)) continue;
			// ###################
			// A [for-each] name only exists while the page is built
			// ###################
			if (!info.staticNames.has(name) && info.loopNames?.has(name)) {
				throw new RuntimeError(`runtime code uses "${name}", a [for-each] name that only exists at build time. To use it in the browser, write it into the markup (for example data-${name}: \${ ${name} }$) and read it there.${wordHint(name)}`, f.id, usedAt.get(name));
			}
			if (!info.staticNames.has(name)) continue;
			if (!info.exportNames.has(name)) {
				throw new RuntimeError(`runtime code uses "${name}", which is not exported from \${ }$. Add "export" to its declaration, or write export { ${name} }, to send it to visitors' browsers.${wordHint(name)}`, f.id, usedAt.get(name));
			}
			values.push(name);
		}

		// ###################
		// A live value using an unknown name close to a declared one: likely a typo
		// ###################
		for (const l of lives) {
			const own = declaredIn(l.ast);
			for (const name of referencedIn(l.ast)) {
				if (declared.has(name) || own.has(name) || info.staticNames.has(name) || name === "ArcMoon" || name in globalThis) continue;
				const best = closest(name, [...declared]);
				if (!best) continue;
				const pos = usedAt.get(name) ?? at(l.marker);
				warnings.push({ source: f.id, position: pos, message: `"${name}" is not defined in this file's runtime code (did you mean "${best}"?)` });
			}
		}

		f.parsed = { hoisted, bodies, lives, values, refsDefined, refCalls, signals, importAt, usedAt };
		return f.parsed;
	};

	// ###################
	// 3. The generated function for one file
	// map: true adds a source map back to the .arcm file (dev builds)
	// ###################
	const sourceOf = (f, { map = false, name = f.id } = {}) => {
		const { hoisted, bodies, lives, values } = f.parsed;
		const lines = [...hoisted];
		const mapped = [];
		const add = (code, marker, column = 0) => {
			const start = marker.codeStart ?? marker.range?.start;
			if (start) mapped.push({ line: lines.length, start, column });
			lines.push(code);
		};
		if (lives.length) lines.push(`import { effect as __effect } from "arcmoon/reactive";`);
		lines.push("export default function (ArcMoon, __values, __live, __setAttr) {");
		if (values.length) lines.push(`const { ${values.join(", ")} } = __values;`);
		for (const b of bodies) add(b.code, b.marker);
		for (const l of lives) {
			const expr = l.marker.code;
			const first = perUse.flatMap((u) => u.live.get(l.key)?.targets ?? [])[0];
			let head;
			if (first?.text) head = `__live(${l.index}, (__node) => __effect(() => { __node.data = String((`;
			else if (/^on/i.test(first.attr)) head = `__live(${l.index}, (__el) => { __el.addEventListener(${JSON.stringify(first.attr.slice(2).toLowerCase())}, (`;
			else head = `__live(${l.index}, (__el) => __effect(() => { __setAttr(__el, ${JSON.stringify(first.attr)}, (`;
			const tail = first?.text ? `) ?? ""); }));` : /^on/i.test(first.attr) ? `)); });` : `)); }));`;
			add(head + expr + tail, l.marker, head.length);
		}
		lines.push("}");
		const code = lines.join("\n");
		return map ? code + "\n" + sourceMap(lines, mapped, name, modules.get(f.id)?.src) : code;
	};

	// ###################
	// 4. Per use: refs table, live targets, values, initial values
	// ###################
	const runs = [];
	const warnedLarge = new Set();
	const descendants = (u) => u.children.flatMap((c) => [perUse[c], ...descendants(perUse[c])]);

	for (const u of perUse) {
		const f = fileOf(u.module);
		const hasCode = f.blocks.length || f.sites.length;
		if (!hasCode) continue;
		const parsed = f.parsed ?? parseFile(f);

		const refs = {};
		for (const [name, pos] of parsed.refsDefined) {
			let found = u.attached.get(name);
			let ids = null;
			if (!found) {
				const inside = descendants(u).map((d) => ({ d, ref: d.attached.get(name) })).filter((x) => x.ref);
				// ###################
				// Found in more than one component use: shared refs are collected, anything else is an error
				// ###################
				if (inside.length > 1) {
					if (inside.some((x) => !x.ref.shared)) {
						const where = new Map();
						for (const { d, ref } of inside) {
							const key = `${fileName(d.module)} (${ref.shared ? "arcm-shared-ref" : "arcm-ref"})`;
							where.set(key, (where.get(key) ?? 0) + 1);
						}
						const list = [...where].map(([key, n]) => (n > 1 ? `${key} ×${n}` : key)).join(", ");
						throw new RuntimeError(`ref "${name}" is attached in more than one component: ${list}. A parent can only collect shared refs; use arcm-shared-ref in all of them, or give each a different name`, f.id, pos);
					}
					ids = inside.map((x) => x.ref.id);
					inside.forEach((x) => (x.ref.used = true));
				}
				found = inside[0]?.ref;
			}
			if (!found) {
				const names = [u, ...descendants(u)].flatMap((d) => [...d.attached.keys()]);
				throw new RuntimeError(`defineRef("${name}") matches no arcm-ref in ${fileName(u.module)}${suggest(name, names)}`, f.id, pos);
			}
			found.used = true;
			refs[name] = ids ? { name, id: found.id, ids, shared: true } : { name, id: found.id, shared: found.shared };
		}

		const binds = new Map(parsed.refCalls.filter((c) => c.bind).map((c) => [c.bind, c.name]));
		for (const c of parsed.refCalls) {
			if (!c.fn || c.name === null) continue;
			const name = typeof c.name === "string" ? c.name : binds.get(c.name.bind);
			const ref = name && refs[name];
			if (!ref) continue;
			if (c.fn === "ref" && ref.shared) throw new RuntimeError(`ArcMoon.ref() used with shared ref "${name}"; use ArcMoon.refs()`, f.id, c.pos);
			if (c.fn === "refs" && !ref.shared) throw new RuntimeError(`ArcMoon.refs() used with single ref "${name}"; use ArcMoon.ref()`, f.id, c.pos);
		}

		const live = {};
		for (const l of parsed.lives) live[l.index] = u.live.get(l.key)?.targets ?? [];

		let values;
		try {
			values = `{${parsed.values.map((n) => {
				let js;
				try {
					js = toJS(u.values[n], n);
				} catch (err) {
					throw new RuntimeError(err.message, f.id, parsed.usedAt.get(n));
				}
				// ###################
				// A large value is copied into the page's JS: warn once per file and name
				// ###################
				const key = `${f.id}:${n}`;
				if (js.length > LARGE_VALUE && !warnedLarge.has(key)) {
					warnedLarge.add(key);
					const kB = (js.length / 1024).toFixed(1);
					warnings.push({ source: f.id, position: parsed.usedAt.get(n), message: `exported value "${n}" is ${kB} kB; it is copied into the page's JS for each use. Export only what runtime code needs` });
				}
				return `${JSON.stringify(n)}:${js}`;
			}).join(",")}}`;
		} catch (err) {
			throw err instanceof RuntimeError ? err : new RuntimeError(err.message, f.id);
		}

		runs.push({ file: f, use: u, refs, live, values });
	}

	// ###################
	// 5. Initial values for live signals: signal(0) or signal(exported)
	// ###################
	for (const t of initialTargets) {
		const f = files.get(t.marker.source);
		const l = f?.parsed?.lives.find((x) => x.key === siteKey(t.marker));
		const e = l?.expr;
		if (!e || e.type !== "CallExpression" || e.arguments.length || e.callee.type !== "Identifier") continue;
		const sig = f.parsed.signals.get(e.callee.name);
		if (!sig) continue;
		const value = "value" in sig ? sig.value : perUse[t.marker.use].values[sig.from];
		if (value === undefined || value === null) continue;
		if (t.text) t.text.value = String(value);
		else if (!/^on/i.test(t.key)) t.element.properties[t.key] = value;
	}

	for (const { node, u, id } of styles) (u.styles ??= {})[id] = node.children.map((c) => c.value ?? "");

	for (const u of perUse) {
		for (const a of u.attached.values()) {
			if (!a.used) warnings.push({ source: u.module, position: null, message: `arcm-ref "${a.name}" is never used by runtime code` });
		}
	}

	if (!runs.length && !scripts.length) return { hasCode: false, files: [], scripts, sourceOf: null, entry: null, warnings };

	const fileList = [...new Set(runs.map((r) => r.file))];

	// ###################
	// The entry module: imports [script] files, the client and each file, runs each use
	// dom is an optional JS expression passed as run()'s third argument
	// ###################
	// ###################
	// label(id) names a file in runtime error messages; Node passes a project-relative path
	// ###################
	const entry = ({ client, fileSpecs, scriptSpecs = [], version, dom = null, label = (id) => id }) =>
		[
			...scriptSpecs.map((spec) => `import ${JSON.stringify(spec)};`),
			...(runs.length ? [`import { run } from ${JSON.stringify(client)};`] : []),
			...fileSpecs.map((spec, i) => `import m${i} from ${JSON.stringify(spec)};`),
			...runs.map((r) => {
				const i = fileList.indexOf(r.file);
				const use = `{ file: ${JSON.stringify(label(r.use.module))}, version: ${JSON.stringify(version)}, refs: ${JSON.stringify(r.refs)}, live: ${JSON.stringify(r.live)}, values: ${r.values}${r.use.styles ? `, styles: ${JSON.stringify(r.use.styles)}` : ""} }`;
				return `run(m${i}, ${use}${dom ? `, ${dom}` : ""});`;
			})
		].join("\n");

	// ###################
	// Where a runtime import of this spec is written, for bundle errors
	// ###################
	const importPosition = (file, spec) => file.parsed?.importAt.get(spec) ?? null;

	return { hasCode: true, files: fileList, scripts, sourceOf, entry, warnings, importPosition };
}
