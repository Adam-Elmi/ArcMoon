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

// ###################
// arcmoon/reactive has only signal, computed and effect: anything else is an error at the import
// ###################
const REACTIVE = ["signal", "computed", "effect"];
const checkReactive = (s, file, at) => {
	for (const sp of s.specifiers) {
		if (sp.type === "ImportNamespaceSpecifier") continue;
		const name = sp.type === "ImportDefaultSpecifier" ? "default" : sp.imported.name ?? sp.imported.value;
		if (REACTIVE.includes(name)) continue;
		const best = name === "default" ? null : closest(name, REACTIVE);
		const what = name === "default" ? "arcmoon/reactive has no default export" : `"${name}" is not in arcmoon/reactive`;
		throw new RuntimeError(`${what}; it has signal, computed and effect${best ? ` (did you mean "${best}"?)` : ""}`, file, at(sp.loc.start));
	}
};

const LARGE_VALUE = 50 * 1024;

// ###################
// await outside any function (await x, for await …): in a block it makes the file's runtime
// function async (1.1); in a live value it is an error
// ###################
const topAwait = (ast) => {
	let found = null;
	walk(ast, (n) => {
		if (!found && (n.type === "AwaitExpression" || (n.type === "ForOfStatement" && n.await))) found = n;
	}, null, true);
	return found;
};
const isMarker = (v) => v !== null && typeof v === "object" && v.type === "runtime";
const siteKey = (m) => `${m.range.start.line}:${m.range.start.character}`;

// ###################
// Small AST walker with parent; skipFunctions stays out of inner functions
// ###################
const walk = (node, visit, parent = null, skipFunctions = false) => {
	if (!node || typeof node.type !== "string") return;
	visit(node, parent);
	if (skipFunctions && parent && /Function/.test(node.type)) return;
	for (const key of Object.keys(node)) {
		const child = node[key];
		if (Array.isArray(child)) child.forEach((c) => walk(c, visit, node, skipFunctions));
		else if (child && typeof child.type === "string") walk(child, visit, node, skipFunctions);
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
// The file's own names: declared at the top level of its runtime code
// (var anywhere outside a function hoists there too), and imports
// ###################
const varNames = (node, out) => {
	walk(node, (n) => {
		if (n.type === "VariableDeclaration" && n.kind === "var") n.declarations.forEach((d) => patternNames(d.id, out));
	}, null, true);
	return out;
};

const lexicalNames = (statements, out) => {
	for (const s of statements) {
		if (s.type === "VariableDeclaration" && s.kind !== "var") s.declarations.forEach((d) => patternNames(d.id, out));
		else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.add(s.id.name);
		else if (s.type === "ImportDeclaration") s.specifiers.forEach((sp) => out.add(sp.local.name));
	}
	return out;
};

const topDeclared = (ast, out = new Set()) => varNames(ast, lexicalNames(ast.body, out));

// ###################
// Names the code reads from outside itself: not declared by an enclosing
// function, block, loop, catch or class. → Map(name → first Identifier)
// ###################
const freeNames = (ast) => {
	const free = new Map();
	const bound = (name, scopes) => scopes.some((s) => s.has(name));
	const use = (id, scopes) => {
		if (!bound(id.name, scopes) && !free.has(id.name)) free.set(id.name, id);
	};
	const pattern = (p, scopes) => {
		if (!p) return;
		if (p.type === "ObjectPattern") p.properties.forEach((q) => (q.type === "RestElement" ? pattern(q.argument, scopes) : (q.computed && go(q.key, scopes), pattern(q.value, scopes))));
		else if (p.type === "ArrayPattern") p.elements.forEach((e) => pattern(e, scopes));
		else if (p.type === "RestElement") pattern(p.argument, scopes);
		else if (p.type === "AssignmentPattern") pattern(p.left, scopes), go(p.right, scopes);
		else if (p.type === "MemberExpression") go(p, scopes);
	};
	const each = (list, scopes) => list.forEach((n) => go(n, scopes));
	const go = (n, scopes) => {
		if (!n || typeof n.type !== "string") return;
		switch (n.type) {
			case "Identifier":
				return use(n, scopes);
			case "FunctionDeclaration":
			case "FunctionExpression":
			case "ArrowFunctionExpression": {
				const scope = new Set();
				if (n.type === "FunctionExpression" && n.id) scope.add(n.id.name);
				n.params.forEach((p) => patternNames(p, scope));
				if (n.body.type === "BlockStatement") lexicalNames(n.body.body, varNames(n.body, scope));
				const inner = [...scopes, scope];
				n.params.forEach((p) => pattern(p, inner));
				return n.body.type === "BlockStatement" ? each(n.body.body, inner) : go(n.body, inner);
			}
			case "ClassDeclaration":
			case "ClassExpression": {
				const inner = n.type === "ClassExpression" && n.id ? [...scopes, new Set([n.id.name])] : scopes;
				go(n.superClass, inner);
				return go(n.body, inner);
			}
			case "BlockStatement":
			case "StaticBlock":
				return each(n.body, [...scopes, lexicalNames(n.body, new Set())]);
			case "ForStatement":
			case "ForInStatement":
			case "ForOfStatement": {
				const head = n.init ?? n.left;
				const scope = new Set();
				if (head?.type === "VariableDeclaration" && head.kind !== "var") head.declarations.forEach((d) => patternNames(d.id, scope));
				const inner = [...scopes, scope];
				for (const key of ["init", "left", "test", "update", "right", "body"]) go(n[key], inner);
				return;
			}
			case "SwitchStatement": {
				go(n.discriminant, scopes);
				const inner = [...scopes, lexicalNames(n.cases.flatMap((c) => c.consequent), new Set())];
				return n.cases.forEach((c) => (go(c.test, inner), each(c.consequent, inner)));
			}
			case "CatchClause": {
				const scope = new Set();
				patternNames(n.param, scope);
				const inner = [...scopes, scope];
				pattern(n.param, inner);
				return go(n.body, inner);
			}
			case "VariableDeclarator":
				pattern(n.id, scopes);
				return go(n.init, scopes);
			case "MemberExpression":
				go(n.object, scopes);
				return n.computed ? go(n.property, scopes) : undefined;
			case "Property":
			case "MethodDefinition":
			case "PropertyDefinition":
				if (n.computed) go(n.key, scopes);
				return go(n.value, scopes);
			case "LabeledStatement":
				return go(n.body, scopes);
			case "BreakStatement":
			case "ContinueStatement":
			case "MetaProperty":
			case "ImportDeclaration":
			case "ExportNamedDeclaration":
			case "ExportDefaultDeclaration":
			case "ExportAllDeclaration":
				return;
			case "AssignmentExpression":
				pattern(n.left.type === "Identifier" ? null : n.left, scopes);
				if (n.left.type === "Identifier") use(n.left, scopes);
				return go(n.right, scopes);
			default:
				for (const key of Object.keys(n)) {
					const child = n[key];
					if (Array.isArray(child)) each(child, scopes);
					else if (child && typeof child.type === "string") go(child, scopes);
				}
		}
	};
	go(ast, []);
	return free;
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

// ###################
// Live [for-each] rows at build time
// ###################

// a value written as a literal in the code ([{ id: 1, title: "x" }], -2, `text`); NO when it isn't one
const NO = Symbol("not a literal");
const literalValue = (n) => {
	switch (n.type) {
		case "Literal":
			return n.regex ? NO : n.value;
		case "TemplateLiteral":
			return n.expressions.length ? NO : n.quasis[0].value.cooked;
		case "Identifier":
			return n.name === "undefined" ? undefined : NO;
		case "UnaryExpression": {
			const v = n.operator === "-" || n.operator === "+" ? literalValue(n.argument) : NO;
			return typeof v === "number" ? (n.operator === "-" ? -v : v) : NO;
		}
		case "ArrayExpression": {
			const out = [];
			for (const e of n.elements) {
				const v = e && e.type !== "SpreadElement" ? literalValue(e) : NO;
				if (v === NO) return NO;
				out.push(v);
			}
			return out;
		}
		case "ObjectExpression": {
			const out = {};
			for (const q of n.properties) {
				if (q.type !== "Property" || q.computed || q.kind !== "init" || q.method || q.shorthand) return NO;
				const v = literalValue(q.value);
				if (v === NO) return NO;
				out[q.key.type === "Identifier" ? q.key.name : String(q.key.value)] = v;
			}
			return out;
		}
		default:
			return NO;
	}
};

const cloneNodes = (nodes) =>
	nodes.map((n) => ({
		...n,
		...(n.properties ? { properties: { ...n.properties } } : {}),
		...(n.data ? { data: { ...n.data } } : {}),
		...(n.children ? { children: cloneNodes(n.children) } : {})
	}));

// put one row value into a cloned row: live text after its <!--arcm:id-->, or an attribute
const fillRow = (nodes, target, v) => {
	for (let k = 0; k < nodes.length; k++) {
		const node = nodes[k];
		if (target.text && node.type === "comment" && node.value === `arcm:${target.id}`) {
			nodes[k + 1].value = String(v ?? "");
			return true;
		}
		if (node.type !== "element") continue;
		if (!target.text && node.properties["data-arcm-in"] === target.id) {
			if (v === null || v === undefined || v === false) delete node.properties[target.attr];
			else node.properties[target.attr] = v === true ? true : String(v);
			return true;
		}
		if (fillRow(node.children, target, v)) return true;
	}
	return false;
};

// globals a row value may use and still be worked out at build time (no Date or Intl:
// their output depends on the computer's time zone and language)
const PLAIN = new Set(["Math", "String", "Number", "Boolean", "Array", "Object", "JSON", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "encodeURI", "undefined", "NaN", "Infinity"]);
const CHANGES = /^(AssignmentExpression|UpdateExpression|ThisExpression|AwaitExpression|YieldExpression|ImportExpression|NewExpression|TaggedTemplateExpression|MetaProperty|Super)$/;

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
	const perUse = uses.map((u) => ({ ...u, blocks: new Map(), live: new Map(), attached: new Map(), each: new Map(), children: [] }));
	for (const u of perUse) if (u.parent !== null) perUse[u.parent].children.push(u.id);

	let elementCount = 0;

	// ###################
	// The id live values use to find their element. A single ref's id is unique, so it is used;
	// a shared ref's id is shared by its elements, so the element gets one of its own next to it
	// (data-arcm-ref holds space-separated ids: "item-u0 e3")
	// ###################
	const ownId = (node) => {
		if (node.data.liveId) return node.data.liveId;
		const current = node.properties["data-arcm-ref"];
		let id = current;
		if (!current || node.data.sharedRef) {
			id = `e${elementCount++}`;
			node.properties["data-arcm-ref"] = current ? `${current} ${id}` : id;
		}
		node.data.liveId = id;
		return id;
	};
	const initialTargets = [];
	const styles = [];

	// ###################
	// The browser's setAttribute refuses these names; say so at build time
	// ###################
	const checkAttr = (key, node, u) => {
		if (!key || /[\s"'>/=\x00-\x1f\x7f]/.test(key)) {
			const what = key ? `can't contain spaces, quotes, ">", "/", "=" or control characters` : "can't be empty";
			throw new RuntimeError(`${JSON.stringify(key)} on [${node.tagName}] is not a valid attribute name: it ${what}`, node.data.source ?? u.module, node.data.position);
		}
	};

	// ###################
	// Live [for-each]: elements with row values get data-arcm-in (not data-arcm-ref, so
	// render() leaves them alone); the browser finds them inside each row
	// ###################
	const eachSites = [];
	const innerId = (node) => {
		if (!node.data.innerId) {
			node.data.innerId = `e${elementCount++}`;
			node.properties["data-arcm-in"] = node.data.innerId;
		}
		return node.data.innerId;
	};
	const visitRow = (children, u, inner, parentTag) => {
		for (let k = 0; k < children.length; k++) {
			const node = children[k];
			if (node.type === "runtime") {
				const id = `t${elementCount++}`;
				node.where = parentTag ? `inside [${parentTag}]` : "in markup";
				children.splice(k, 1, { type: "comment", value: `arcm:${id}` }, { type: "text", value: "" }, { type: "comment", value: "/arcm" });
				k += 2;
				inner.push({ marker: node, target: { id, text: true } });
				continue;
			}
			if (node.type !== "element") continue;
			const where = node.data.source ?? u.module;
			if (node.tagName.toLowerCase() === "script") throw new RuntimeError("[script] inside a live [for-each] isn't supported", where, node.data.position);
			const { directives } = node.data;
			if (directives.ref !== undefined) {
				throw new RuntimeError(`arcm-ref on [${node.tagName}] inside a live [for-each] would be on every row; use arcm-shared-ref and ArcMoon.refs()`, where, node.data.position);
			}
			const shared = directives["shared-ref"];
			if (shared !== undefined) {
				if (typeof shared !== "string" || !shared) throw new RuntimeError(`arcm-ref on [${node.tagName}] must be a quoted name`, where, node.data.position);
				const seen = u.attached.get(shared);
				if (seen && !seen.shared) throw new RuntimeError(`single ref "${shared}" is attached to 2 elements; use arcm-shared-ref`, where, node.data.position);
				if (!seen) u.attached.set(shared, { name: shared, id: `${shared}-u${u.id}`, shared: true, used: false });
				node.properties["data-arcm-ref"] = u.attached.get(shared).id;
			}
			for (const [key, value] of Object.entries(node.properties)) {
				if (!isMarker(value)) continue;
				checkAttr(key, node, u);
				delete node.properties[key];
				value.where = `for "${key}" on [${node.tagName}]`;
				inner.push({ marker: value, target: { id: innerId(node), attr: key } });
			}
			if (node.tagName.toLowerCase() === "style" && node.children.some((c) => c.type === "runtime")) {
				throw new RuntimeError("live text in a [style] inside a live [for-each] isn't supported; use a -- prop on an element", where, node.data.position);
			}
			visitRow(node.children, u, inner, node.tagName);
		}
	};

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
			// A live [for-each]: <!--arcm-each:id--> marks where its rows start; rows go before
			// its <template> (written at build time in step 6 when the first list is known)
			// ###################
			if (node.data.each) {
				const u = perUse[node.data.use];
				const { marker, as, key } = node.data.each;
				const id = ownId(node);
				const inner = [];
				visitRow(node.children, u, inner, null);
				marker.where = "as the list of a live [for-each]";
				children.splice(k++, 0, { type: "comment", value: `arcm-each:${id}` });
				addLive(marker, { id, each: true, key, inner: inner.map((x) => x.target) });
				u.each.set(siteKey(marker), { as, key, inner: inner.map((x) => x.marker) });
				eachSites.push({ marker, key, node, children, inner, u });
				continue;
			}

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
				node.data.sharedRef = shared;
			}

			for (const [key, value] of Object.entries(node.properties)) {
				if (!isMarker(value)) continue;
				checkAttr(key, node, u);
				delete node.properties[key];
				value.where = `for "${key}" on [${node.tagName}]`;
				const target = addLive(value, { id: ownId(node), attr: key });
				initialTargets.push({ marker: value, element: node, key, target });
			}

			// ###################
			// Live text in a page [style]: the client rebuilds the whole CSS text
			// ###################
			if (node.tagName.toLowerCase() === "style" && node.children.some((c) => c.type === "runtime")) {
				const id = ownId(node);
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
		const each = new Map();
		for (const u of perUse) {
			if (u.module !== id) continue;
			for (const [k, b] of u.blocks) blocks.set(k, b);
			for (const [k, s] of u.live) sites.set(k, s.marker);
			for (const [k, e] of u.each) if (!each.has(k)) each.set(k, e);
		}
		const f = { id, blocks: [...blocks.values()], sites: [...sites.entries()], each, parsed: null };
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
		const signalInits = new Map();
		const reactive = new Set();
		const bodies = [];
		const lives = [];
		const rowLives = [];
		let awaits = false;

		const scan = (ast, marker, live = false) => {
			walk(ast, (n, p) => {
				const isArc = (name) => n.type === "CallExpression" && n.callee.type === "MemberExpression" &&
					n.callee.object.name === "ArcMoon" && n.callee.property.name === name;
				// props only exist at build time: read them in ${ }$ and export what the browser needs
				if (isArc("props")) {
					throw new RuntimeError("ArcMoon.props() only exists at build time; read props in ${ }$ and export what runtime code needs", f.id, at(marker, n.loc.start, live));
				}
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
					if (s.source.value === "arcmoon/reactive") checkReactive(s, f.id, (loc) => at(b, loc));
					edits.push(s);
				} else if (/^Export/.test(s.type)) {
					throw new RuntimeError("export is not allowed in runtime code", f.id, at(b, s.loc.start));
				} else if (s.type === "VariableDeclaration") {
					for (const d of s.declarations) {
						const init = d.init;
						if (d.id.type === "Identifier" && init?.type === "CallExpression" && (init.callee.name === "signal" || init.callee.name === "computed")) reactive.add(d.id.name);
						if (d.id.type === "Identifier" && init?.type === "CallExpression" && init.callee.name === "signal" && init.arguments.length === 1) {
							const a = init.arguments[0];
							signalInits.set(d.id.name, a);
							if (a.type === "Literal" && !a.regex) signals.set(d.id.name, { value: a.value });
							else if (a.type === "Identifier") signals.set(d.id.name, { from: a.name });
						}
					}
				}
			}
			for (const s of edits.reverse()) code = code.slice(0, s.start) + code.slice(s.start, s.end).replace(/[^\n]/g, " ") + code.slice(s.end);
			if (topAwait(ast)) awaits = true;
			topDeclared(ast, declared);
			scan(ast, b);
			bodies.push({ code, ast, marker: b });
		}

		const parseLive = (marker) => {
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
			const waits = topAwait(ast);
			if (waits) {
				throw new RuntimeError(`await can't be used in a live value (runtime \${ }$ ${marker.where ?? "in markup"}): live values update at once. Await in a runtime \${ }$ block at the top level of the file, and put the result in a signal`, f.id, at(marker, waits.loc.start, true));
			}
			scan(ast, marker, true);
			return { marker, ast, expr: ast.body[0].expression };
		};
		f.sites.forEach(([key, marker], index) => {
			const loop = f.each.get(key);
			// ###################
			// A live [for-each]'s row values: its names (as, i) are theirs
			// ###################
			const each = loop ? { as: loop.as, key: loop.key, inner: loop.inner.map((m) => ({ ...parseLive(m), row: new Set([loop.as, "i"]) })) } : null;
			if (each) rowLives.push(...each.inner);
			lives.push({ key, index, ...parseLive(marker), each });
		});

		// ###################
		// Compile-time names used here must be exported
		// ###################
		// ###################
		// Names read from outside the code itself, and where each is first read
		// (a name declared inside a function or block only hides it there)
		// ###################
		const used = new Set();
		const usedIn = new Map();
		for (const x of [...bodies, ...lives, ...rowLives]) {
			for (const [name, id] of freeNames(x.ast)) {
				if (x.row?.has(name)) continue;
				used.add(name);
				if (usedAt.has(name)) continue;
				usedAt.set(name, at(x.marker, id.loc.start, !bodies.includes(x)));
				usedIn.set(name, x.marker);
			}
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
		for (const l of [...lives, ...rowLives]) {
			for (const name of freeNames(l.ast).keys()) {
				if (l.row?.has(name) || declared.has(name) || info.staticNames.has(name) || name === "ArcMoon" || name in globalThis) continue;
				const best = closest(name, [...declared]);
				if (!best) continue;
				const pos = usedAt.get(name) ?? at(l.marker);
				warnings.push({ source: f.id, position: pos, message: `"${name}" is not defined in this file's runtime code (did you mean "${best}"?)` });
			}
		}

		// ###################
		// A signal shown without () (B41): the page would show the function, or a list nothing
		// ###################
		for (const l of [...lives, ...rowLives]) {
			const e = l.expr;
			if (e?.type !== "Identifier" || !reactive.has(e.name) || l.row?.has(e.name) || /^for "on/i.test(l.marker.where ?? "")) continue;
			warnings.push({ source: f.id, position: at(l.marker, e.loc.start, true), message: `"${e.name}" is a signal; read it with ${e.name}()` });
		}

		// ###################
		// Names this file's code reads but nothing here declares (for B42, across files)
		// ###################
		const unknown = new Map();
		for (const name of used) {
			if (declared.has(name) || info.staticNames.has(name) || name === "ArcMoon" || name in globalThis) continue;
			unknown.set(name, usedAt.get(name));
		}

		f.parsed = { hoisted, bodies, lives, values, refsDefined, refCalls, signals, signalInits, importAt, usedAt, awaits, declared, unknown };
		return f.parsed;
	};

	// ###################
	// 3. The generated function for one file
	// map: true adds a source map back to the .arcm file (dev builds)
	// ###################
	const sourceOf = (f, { map = false, name = f.id } = {}) => {
		const { hoisted, bodies, lives, values, awaits } = f.parsed;
		const lines = [...hoisted];
		const mapped = [];
		const add = (code, marker, column = 0) => {
			const start = marker.codeStart ?? marker.range?.start;
			if (start) mapped.push({ line: lines.length, start, column });
			lines.push(code);
		};
		// ###################
		// Event props are plain listeners: a file whose live values are all events doesn't
		// load arcmoon/reactive (B25)
		// ###################
		const isEvent = (l) => {
			const t = perUse.flatMap((u) => u.live.get(l.key)?.targets ?? [])[0];
			return Boolean(t && !t.text && !t.each && /^on/i.test(t.attr ?? ""));
		};
		if (lives.some((l) => !isEvent(l))) lines.push(`import { effect as __effect${lives.some((l) => l.each) ? ", each as __each" : ""} } from "arcmoon/reactive";`);
		lines.push(`export default ${awaits ? "async " : ""}function (ArcMoon, __values, __live, __setAttr) {`);
		if (values.length) lines.push(`const { ${values.join(", ")} } = __values;`);
		for (const b of bodies) add(b.code, b.marker);
		for (const l of lives) {
			const expr = l.marker.code;
			const first = perUse.flatMap((u) => u.live.get(l.key)?.targets ?? [])[0];
			// ###################
			// A live [for-each]: __each keeps one row per item; each row value reads the row's
			// item and index (signals), so it updates when the list changes
			// ###################
			if (l.each) {
				const head = `__live(${l.index}, (__spot) => __each(__spot, () => (`;
				add(`${head}${expr}), (__row, __in) => {`, l.marker, head.length);
				const names = `const ${l.each.as} = __row.item(), i = __row.index();`;
				l.each.inner.forEach((x, j) => {
					const t = first.inner[j];
					let h;
					let tail;
					if (t.text) {
						h = `__in(${j}, (__node) => __effect(() => { ${names} __node.data = String((`;
						tail = `) ?? ""); }));`;
					} else if (/^on/i.test(t.attr)) {
						h = `__in(${j}, (__el) => { __el.addEventListener(${JSON.stringify(t.attr.slice(2).toLowerCase())}, function (__e) { ${names} return (`;
						tail = `).call(this, __e); }); });`;
					} else {
						h = `__in(${j}, (__el) => __effect(() => { ${names} __setAttr(__el, ${JSON.stringify(t.attr)}, (`;
						tail = `)); }));`;
					}
					add(h + x.marker.code + tail, x.marker, h.length);
				});
				lines.push("}));");
				continue;
			}
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

	// ###################
	// 6. Live [for-each] rows written at build time, when the list's first value is known:
	// signal([…literal…]) or signal(exported value). In each row, values that only need the
	// item, i, exported values and plain JavaScript are filled in; the script fills the rest.
	// Each row starts with <!--arcm-row:key-->, so the browser adopts it instead of drawing it
	// ###################
	const firstList = (f, expr, u) => {
		if (!expr || expr.type !== "CallExpression" || expr.arguments.length || expr.callee.type !== "Identifier") return undefined;
		const init = f.parsed.signalInits.get(expr.callee.name);
		if (!init) return undefined;
		if (init.type === "Identifier") return f.parsed.values.includes(init.name) ? u.values[init.name] : undefined;
		const v = literalValue(init);
		return v === NO ? undefined : v;
	};
	const rowFunction = (x, as, values, u) => {
		let changes = false;
		walk(x.ast, (n) => {
			if (CHANGES.test(n.type) || (n.type === "UnaryExpression" && n.operator === "delete")) changes = true;
		});
		if (changes) return null;
		const params = [as, "i"];
		const args = [];
		for (const name of freeNames(x.ast).keys()) {
			if (name === as || name === "i" || PLAIN.has(name)) continue;
			if (!values.includes(name)) return null;
			params.push(name);
			args.push(u.values[name]);
		}
		try {
			const fn = new Function(...params, `"use strict"; return (${x.marker.code}\n);`);
			return (item, index) => fn(item, index, ...args);
		} catch {
			return null;
		}
	};
	for (const site of eachSites) {
		const f = files.get(site.marker.source);
		const l = f?.parsed?.lives.find((x) => x.key === siteKey(site.marker));
		const list = l && firstList(f, l.expr, site.u);
		if (!Array.isArray(list)) continue;
		const fills = l.each.inner.map((x, j) => {
			const target = site.inner[j].target;
			return { target, fn: target.attr && /^on/i.test(target.attr) ? null : rowFunction(x, l.each.as, f.parsed.values, site.u) };
		});
		const rows = [];
		list.forEach((item, index) => {
			const keyText = JSON.stringify(site.key === null ? index : item?.[site.key]);
			if (keyText === undefined) return;
			const nodes = cloneNodes(site.node.children);
			for (const { target, fn } of fills) {
				if (!fn) continue;
				let v;
				try {
					v = fn(item, index);
				} catch {
					continue;
				}
				fillRow(nodes, target, v);
			}
			rows.push({ type: "comment", value: `arcm-row:${encodeURIComponent(keyText)}` }, ...nodes);
		});
		site.children.splice(site.children.indexOf(site.node), 0, ...rows);
	}

	// ###################
	// A name only another file's runtime code declares (B42): each file has its own scope,
	// so it is undefined here in the browser
	// ###################
	const parsedFiles = [...files.values()].filter((f) => f.parsed);
	for (const f of parsedFiles) {
		for (const [name, position] of f.parsed.unknown) {
			const other = parsedFiles.find((g) => g !== f && g.parsed.declared.has(name));
			if (other) warnings.push({ source: f.id, position, message: `"${name}" is declared in ${fileName(other.id)}'s runtime code, not here; each file has its own scope, so here it is undefined in the browser` });
		}
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
