// ###################
// ArcMoon evaluator: turns .arcm into render code, runs it, builds the tree
// ###################

import * as acorn from "acorn";
import { NODE_TYPES as N } from "./parser.js";
import { COMPONENT } from "./modules.js";
import scopeStyles from "./css.js";
import { EvaluatorError } from "./errors.js";

const ID_RE = /^[A-Za-z_$][\w$]*$/;
const ACORN = {
	ecmaVersion: "latest",
	sourceType: "module",
	allowAwaitOutsideFunction: true,
	allowReturnOutsideFunction: true,
	locations: true
};

export { EvaluatorError };

// ###################
// Small AST walker, can skip function bodies
// ###################
const walk = (node, visit, parent = null, skipFunctions = false) => {
	if (!node || typeof node.type !== "string") return;
	visit(node, parent);
	if (skipFunctions && /Function/.test(node.type)) return;
	for (const key of Object.keys(node)) {
		const child = node[key];
		if (Array.isArray(child)) child.forEach((c) => walk(c, visit, node, skipFunctions));
		else if (child && typeof child.type === "string") walk(child, visit, node, skipFunctions);
	}
};

const declaredNames = (decl) => {
	const names = [];
	const collect = (p) => {
		if (!p) return;
		if (p.type === "Identifier") names.push(p.name);
		else if (p.type === "ObjectPattern") p.properties.forEach((q) => collect(q.type === "RestElement" ? q.argument : q.value));
		else if (p.type === "ArrayPattern") p.elements.forEach(collect);
		else if (p.type === "RestElement") collect(p.argument);
		else if (p.type === "AssignmentPattern") collect(p.left);
	};
	if (decl.type === "VariableDeclaration") decl.declarations.forEach((d) => collect(d.id));
	else if (decl.id) names.push(decl.id.name);
	return names;
};

// ###################
// .json imports work like in runtime code: attribute added, named imports allowed
// ###################
const jsonImport = (s, code) => {
	const text = code.slice(s.start, s.end);
	if (!/\.json$/.test(s.source.value) || s.attributes?.length) return [text];

	const source = JSON.stringify(s.source.value);
	const def = s.specifiers.find((sp) => sp.type === "ImportDefaultSpecifier");
	const name = def ? def.local.name : `__json_${s.source.value.replace(/\W/g, "_")}`;
	const lines = [`import ${name} from ${source} with { type: "json" };`];

	const named = s.specifiers.filter((sp) => sp.type === "ImportSpecifier");
	if (named.length) {
		const parts = named.map((sp) => {
			const key = sp.imported.name ?? sp.imported.value;
			return key === sp.local.name ? key : `${JSON.stringify(key)}: ${sp.local.name}`;
		});
		lines.push(`const { ${parts.join(", ")} } = ${name};`);
	}
	const ns = s.specifiers.find((sp) => sp.type === "ImportNamespaceSpecifier");
	if (ns) lines.push(`const ${ns.local.name} = { default: ${name}, ...${name} };`);
	return lines;
};

// ###################
// Which caller props a component reads with ArcMoon.props()
// ###################
const readPropsOf = (asts) => {
	const read = new Set();
	let all = false;
	for (const ast of asts) {
		walk(ast, (node, parent) => {
			const isCall =
				node.type === "CallExpression" &&
				node.callee.type === "MemberExpression" &&
				node.callee.object.name === "ArcMoon" &&
				node.callee.property.name === "props";
			if (!isCall) return;
			if (parent?.type === "VariableDeclarator" && parent.init === node && parent.id.type === "ObjectPattern") {
				for (const p of parent.id.properties) {
					if (p.type === "RestElement" || p.computed) all = true;
					else read.add(p.key.name ?? String(p.key.value));
				}
			} else if (parent?.type === "MemberExpression" && parent.object === node && !parent.computed) {
				read.add(parent.property.name);
			} else if (parent?.type === "MemberExpression" && parent.object === node && parent.property.type === "Literal") {
				read.add(String(parent.property.value));
			} else {
				all = true;
			}
		});
	}
	return all ? null : read;
};

// ###################
// Turn one module's AST into JS code
// ###################
// ###################
// A ${ }$ block outputs nothing when its last statement is not a value
// ###################
const outputsNothing = (code) => {
	try {
		const probe = acorn.parse(`(${code}\n)`, ACORN);
		if (probe.body.length === 1 && probe.body[0].type === "ExpressionStatement") return false;
	} catch {}
	try {
		const statements = acorn.parse(code, ACORN).body.filter((s) => s.type !== "ImportDeclaration");
		const last = statements[statements.length - 1];
		return !last || (last.type !== "ExpressionStatement" && last.type !== "ReturnStatement");
	} catch {
		return false;
	}
};

// ###################
// A line holding only silent things (import, comment, runtime block,
// a ${ }$ with no output, a component's [style]) is removed with its indent and line break
// ###################
const standalone = (nodes, isTop, removeComments, isComponent) => {
	const silent = (n) =>
		n.type === N.IMPORT ||
		(isComponent && n.type === N.BLOCK && n.id.toLowerCase() === "style") ||
		(removeComments && (n.type === N.COMMENT || n.type === N.COMMENT_BLOCK)) ||
		(isTop && n.type === N.RUNTIME_LOGIC) ||
		(n.type === N.STATIC_LOGIC && outputsNothing(n.code));
	const isText = (n) => n?.type === N.TEXT;
	const out = nodes.map((n) => (isText(n) ? { ...n } : n));

	let k = 0;
	while (k < out.length) {
		if (!silent(out[k])) {
			k++;
			continue;
		}
		// ###################
		// A run: silent nodes, maybe with spaces (no line break) between them
		// ###################
		let end = k;
		while (end + 1 < out.length) {
			const next = out[end + 1];
			if (silent(next)) end++;
			else if (isText(next) && /^[ \t]*$/.test(next.text) && silent(out[end + 2] ?? {})) end += 2;
			else break;
		}
		const before = out[k - 1];
		const after = out[end + 1];
		const lineStart = !before || (isText(before) && /(^|\n)[ \t]*$/.test(before.text) && (k - 1 > 0 || /\n[ \t]*$|^[ \t]*$/.test(before.text)));
		const lineEnd = !after || (isText(after) && /^[ \t]*(\r?\n|$)/.test(after.text));
		if (lineStart && lineEnd) {
			if (isText(before)) before.text = before.text.replace(/[ \t]*$/, "");
			if (isText(after)) after.text = after.text.replace(/^[ \t]*\r?\n?/, "");
			for (let j = k; j <= end; j++) if (isText(out[j])) out[j].text = "";
		}
		k = end + 1;
	}
	return out.filter((n) => !isText(n) || n.text !== "");
};

const generate = (mod, removeComments = true, isComponent = false) => {
	const hoisted = new Set();
	const warnings = [];
	const srcLines = (mod.src ?? "").split("\n");
	const staticNames = new Set();
	const exportNames = new Set();
	const loopNames = new Set();
	const map = [];
	const topAsts = [];
	let body = "";
	let line = 0;
	let uid = 0;

	const out = (text) => {
		body += text;
		line += (text.match(/\n/g) || []).length;
	};

	const fail = (message, position) => {
		throw new EvaluatorError(message, mod.id, position);
	};

	// ###################
	// Rewrite user code: hoist imports, handle export and the last value
	// ###################
	const transform = (logic, mode, target, isTop, el) => {
		const code = logic.code;
		const start = { line: logic.range.start.line, character: logic.range.start.character + 2 };
		const at = (loc) => ({
			line: start.line + loc.line - 1,
			character: loc.line === 1 ? start.character + loc.column : loc.column
		});

		// ###################
		// ArcMoon.props() inside an element, reading a prop the element doesn't have
		// ###################
		const checkProps = (tree) => {
			if (!el) return;
			const read = readPropsOf([tree]);
			for (const key of read ?? []) {
				if (el.keys.includes(key)) continue;
				warnings.push({
					position: start,
					message: `ArcMoon.props() inside [${el.tag}] returns the [${el.tag}]'s props, which have no "${key}"; for the component's props, call it at the top of the file`
				});
			}
		};

		// ###################
		// A plain name or a.b as output: warn if it is undefined
		// The value is computed first, outside any call, so errors point at the real spot
		// ###################
		const isName = (e) => e?.type === "Identifier" || (e?.type === "MemberExpression" && !e.computed && isName(e.object));
		// No parentheses around the value: V8 would point errors at the "("
		// ###################
		const emitCall = (expr, inner) => {
			const v = `__v${uid++}`;
			const paren = expr?.type === "SequenceExpression";
			const tail =
				mode === "value"
					? `return ${v}`
					: isName(expr)
						? `__am.emitCheck(${target}, ${v}, ${JSON.stringify(inner.trim())}, ${JSON.stringify(start)})`
						: `__am.emit(${target}, ${v})`;
			return [`const ${v} = ${paren ? "(" : ""}`, `${paren ? ")" : ""}; ${tail}`];
		};

		// ###################
		// A block that is one expression, like { raw: x }, is a value
		// ###################
		let single = null;
		try {
			const probe = acorn.parse(`(${code}\n)`, ACORN);
			if (probe.body.length === 1 && probe.body[0].type === "ExpressionStatement") single = probe;
		} catch {}
		if (single) {
			if (isTop) topAsts.push(single);
			checkProps(single);
			const [open, close] = emitCall(single.body[0].expression, code);
			out("\n");
			map.push({ gen: line, src: start, shifts: [{ line: 0, col: open.length, shift: open.length, clamp: true }] });
			out(open + code);
			out(`\n${close};\n`);
			return;
		}

		let ast;
		try {
			ast = acorn.parse(code, ACORN);
		} catch (err) {
			fail(`SyntaxError: ${err.message.replace(/ \(\d+:\d+\)$/, "")}`, at(err.loc));
		}
		if (isTop) topAsts.push(ast);
		checkProps(ast);

		// ###################
		// Names declared here; runtime code may only use exported ones
		// ###################
		for (const s of ast.body) {
			const decl = s.type === "ExportNamedDeclaration" ? s.declaration : s;
			if (s.type === "ImportDeclaration") {
				s.specifiers.forEach((sp) => staticNames.add(sp.local.name));
			} else if (decl && /Declaration$/.test(decl.type)) {
				declaredNames(decl).forEach((name) => staticNames.add(name));
			}
			if (s.type === "ExportNamedDeclaration") {
				if (s.declaration) declaredNames(s.declaration).forEach((name) => exportNames.add(name));
				else s.specifiers.forEach((sp) => exportNames.add(sp.exported.name ?? sp.exported.value));
			}
		}

		walk(ast, (node) => {
			if (node.type === "ReturnStatement" && node !== ast.body[ast.body.length - 1]) {
				fail("return is only allowed as the last statement of ${ }$", at(node.loc.start));
			}
		}, null, true);

		const edits = [];
		const shifts = [];
		const blank = (node) => code.slice(node.start, node.end).replace(/[^\n]/g, " ");
		const statements = ast.body.filter((s) => s.type !== "ImportDeclaration");

		for (const s of ast.body) {
			if (s.type === "ImportDeclaration") {
				if (mode === "value") fail("import is only allowed in a ${ }$ block, not in a prop value", at(s.loc.start));
				jsonImport(s, code).forEach((line) => hoisted.add(line));
				edits.push({ start: s.start, end: s.end, text: blank(s) });
			} else if (s.type === "ExportNamedDeclaration") {
				if (mode === "value") fail("export is only allowed in a ${ }$ block", at(s.loc.start));
				if (s.declaration) {
					const names = declaredNames(s.declaration);
					edits.push({ start: s.start, end: s.declaration.start, text: " ".repeat(s.declaration.start - s.start) });
					edits.push({ start: s.end, end: s.end, text: ` __am.export({ ${names.join(", ")} });` });
				} else {
					if (s.source) fail("export ... from is not supported in ${ }$", at(s.loc.start));
					const pairs = s.specifiers.map((sp) => `${JSON.stringify(sp.exported.name ?? sp.exported.value)}: ${sp.local.name}`);
					edits.push({ start: s.start, end: s.end, text: `__am.export({ ${pairs.join(", ")} });` });
				}
			} else if (s.type === "ExportDefaultDeclaration" || s.type === "ExportAllDeclaration") {
				fail("only named exports are allowed in ${ }$", at(s.loc.start));
			}
		}

		const last = statements[statements.length - 1];
		if (last && (last.type === "ExpressionStatement" || last.type === "ReturnStatement")) {
			const expr = last.type === "ExpressionStatement" ? last.expression : last.argument;
			const inner = expr ? code.slice(expr.start, expr.end) : "undefined";
			const [open, close] = expr ? emitCall(expr, inner) : ["", ""];
			const text = expr ? `${open}${inner}${close};` : mode === "value" ? "return undefined;" : "";
			edits.push({ start: last.start, end: last.end, text });
			if (expr) {
				const shift = text.indexOf(inner) - (expr.start - last.start);
				shifts.push({ line: expr.loc.start.line - 1, col: expr.loc.start.column + shift, shift });
			}
		}

		let result = code;
		for (const e of edits.sort((a, b) => b.start - a.start)) {
			result = result.slice(0, e.start) + e.text + result.slice(e.end);
		}

		out("\n");
		map.push({ gen: line, src: start, shifts });
		out(result);
		out("\n");
	};

	const value = (v, isTop, el) => {
		if (v && v.type === N.STATIC_LOGIC) {
			out("(await (async () => {");
			transform(v, "value", null, isTop, el);
			out("})())");
		} else if (v && v.type === N.RUNTIME_LOGIC) {
			out(`__am.runtime(${JSON.stringify(v.code)}, ${JSON.stringify(v.range)}, "live", ${JSON.stringify(v.codeStart)})`);
		} else {
			out(JSON.stringify(v));
		}
	};

	const props = (p, isTop, el) => {
		out("{");
		for (const [k, v] of Object.entries(p)) {
			out(`${JSON.stringify(k)}: `);
			value(v, isTop, el);
			out(", ");
		}
		out("}");
	};

	const children = (nodes, target, isTop, el) => {
		nodes = standalone(nodes, isTop, removeComments, isComponent);
		for (const node of nodes) one(node, target, isTop, el);
	};

	// ###################
	// One AST node into code
	// ###################
	const one = (node, T, isTop, el = null) => {
		const n = uid++;
		switch (node.type) {
			case N.TEXT:
				return out(`${T}.push(__am.text(${JSON.stringify(node.text)}));\n`);
			case N.COMMENT:
			case N.COMMENT_BLOCK:
				return out(`__am.comment(${T}, ${JSON.stringify(node.text)});\n`);
			case N.IMPORT:
				return;
			case N.STATIC_LOGIC:
				return transform(node, "block", T, isTop, el);
			case N.RUNTIME_LOGIC: {
				// ###################
				// "The runtime ${ x }$": right after a word in text, maybe meant as the English word
				// ###################
				const before = (srcLines[node.range.start.line] ?? "").slice(0, node.range.start.character);
				const afterWord = !isTop && /[A-Za-z][.,!?]?\s+$/.test(before);
				return out(`${T}.push(__am.runtime(${JSON.stringify(node.code)}, ${JSON.stringify(node.range)}, ${isTop ? '"block"' : '"live"'}, ${JSON.stringify(node.codeStart)}, ${afterWord}));\n`);
			}
			case N.BLOCK:
				if (isComponent && node.id.toLowerCase() === "style") {
					const live = node.body.find((c) => c.type === N.RUNTIME_LOGIC);
					if (live) fail("runtime ${ }$ is not allowed in a component's [style]: one stylesheet is shared by every use. Use a -- prop instead, like [div = --color: runtime ${ … }$]", live.range.start);
				}
				out(`{ const __p${n} = `);
				props(node.props, isTop, el);
				out(`; const __c${n} = [];\n{ const ArcMoon = __am.scope(__p${n});\n`);
				children(node.body, `__c${n}`, false, { tag: node.id, keys: Object.keys(node.props) });
				return out(`}\n${T}.push(__am.el(${JSON.stringify(node.id)}, __p${n}, __c${n}, ${JSON.stringify(node.directives)}, ${JSON.stringify(node.range.start)})); }\n`);
			case COMPONENT:
				out(`{ const __p${n} = `);
				props(node.props, isTop, el);
				out(";\n");
				if (node.isSelfClosing || node.body.length === 0) {
					out(`const __s${n} = null;\n`);
				} else {
					out(`const __s${n} = async () => { const __c${n} = [];\n`);
					children(node.body, `__c${n}`, false, el);
					out(`return __c${n}; };\n`);
				}
				return out(`${T}.push(...await __am.component(${JSON.stringify(node.module)}, __p${n}, __s${n}, ${JSON.stringify(node.directives)})); }\n`);
			case N.SLOT:
				out(`if (__slot) ${T}.push(...await __slot()); else {\n`);
				children(node.body, T, isTop, el);
				return out("}\n");
			case N.FOR_EACH:
				if (node.source.type === N.RUNTIME_LOGIC) fail("live [for-each] (runtime ${ }$) is not supported yet", node.range.start);
				if (!ID_RE.test(node.as) || node.as === "i") fail(`as: "${node.as}" must be a valid JS name (not "i")`, node.range.start);
				loopNames.add(node.as).add("i");
				out(`{ const __src${n} = `);
				value(node.source, isTop, el);
				out(`;\nfor (const [i, ${node.as}] of Array.from(__src${n} ?? []).entries()) {\n`);
				children(node.body, T, isTop, el);
				return out("} }\n");
			default:
				fail(`unknown node ${node.type}`, node.range?.start);
		}
	};

	children(mod.ast, "__root", true);

	const header = [...hoisted].join("\n") + "\n" +
		"export default async function (__am, __props, __slot) {\n" +
		"const ArcMoon = __am.scope(__props);\n" +
		"const __root = [];\n";
	const offset = (header.match(/\n/g) || []).length;
	const code = header + body + "\nreturn __root;\n}\n";

	return {
		code,
		map: map.map((m) => ({ ...m, gen: m.gen + offset })),
		readProps: readPropsOf(topAsts),
		staticNames,
		exportNames,
		loopNames,
		warnings
	};
};

// ###################
// Map a generated line back to the .arcm file
// ###################
const toSource = (compiled, genLine, genCol) => {
	let best = null;
	for (const m of compiled.map) if (m.gen <= genLine) best = m;
	if (!best) return null;
	const offset = genLine - best.gen;
	for (const s of best.shifts) {
		if (s.line !== offset) continue;
		if (genCol >= s.col) genCol -= s.shift;
		else if (s.clamp) genCol = 0;
	}
	return {
		line: best.src.line + offset,
		character: offset === 0 ? best.src.character + genCol : genCol
	};
};

const withTimeout = (promise, ms, label) => {
	if (!ms) return promise;
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} took longer than ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// ###################
// Run the whole module graph and return the tree
// options.importModule(code, id) -> { render, keys }; keys appear in error stacks
// ###################
export default async function evaluate(graph, options = {}) {
	const {
		props: pageProps = {},
		removeComments = true,
		timeout = 5000,
		version = "0.0.0",
		importModule,
		onRun = null
	} = options;
	if (typeof importModule !== "function") throw new TypeError("evaluate: options.importModule is required");

	const compiled = new Map();
	const byFile = new Map();
	const uses = [];
	const warnings = [];
	const warned = new Set();

	const warn = (source, position, message) => {
		const key = `${source}:${position.line}:${position.character}:${message}`;
		if (warned.has(key)) return;
		warned.add(key);
		warnings.push({ source, position, message });
	};

	const runtimeOnly = (name) => () => {
		throw new Error(`ArcMoon.${name}() is only available in runtime blocks`);
	};

	// ###################
	// Compile and import one module (once)
	// ###################
	const load = async (id) => {
		if (compiled.has(id)) return compiled.get(id);
		const mod = graph.modules.get(id);
		const result = generate(mod, removeComments, id !== graph.entry);
		for (const w of result.warnings) warn(id, w.position, w.message);
		const { render, keys } = await importModule(result.code, id);
		result.render = render;
		result.id = id;
		compiled.set(id, result);
		for (const key of keys) byFile.set(key, result);
		return result;
	};

	// ###################
	// Point runtime errors at the .arcm line
	// ###################
	const rethrow = (err) => {
		if (err instanceof EvaluatorError) throw err;
		for (const line of String(err?.stack).split("\n")) {
			for (const [key, result] of byFile) {
				const at = line.lastIndexOf(key + ":");
				if (at === -1) continue;
				const m = /^(\d+):(\d+)/.exec(line.slice(at + key.length + 1));
				if (!m) continue;
				const pos = toSource(result, Number(m[1]) - 1, Number(m[2]) - 1);
				throw new EvaluatorError(`${err.name}: ${err.message}`, result.id, pos, err);
			}
		}
		throw err;
	};

	// ###################
	// Values returned from ${ }$ into the tree
	// ###################
	const emit = (T, v) => {
		if (v === null || v === undefined || typeof v === "boolean") return;
		if (Array.isArray(v)) return v.forEach((x) => emit(T, x));
		if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
			return T.push({ type: "text", value: String(v) });
		}
		if (typeof v === "object" && typeof v.raw === "string") return T.push({ type: "raw", value: v.raw });
		throw new TypeError(`can't render ${Object.prototype.toString.call(v)}; return text, { raw }, or an array`);
	};

	// ###################
	// Unread props and directives go onto the root element
	// ###################
	// ###################
	// A component file's final line break is not output (§5.7): editors add one to every
	// file, and inside text it would show as a space ("Syntax ," after [Link …])
	// ###################
	// (a [style] or [link] at the end moves to <head> later, so the break before it is the last one too)
	const dropFinalBreak = (nodes) => {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const node = nodes[i];
			if (node.type === "element" && /^(style|link)$/i.test(node.tagName)) continue;
			if (node.type !== "text") return;
			node.value = node.value.replace(/\r?\n[ \t]*$/, "");
			if (node.value) return;
			nodes.splice(i, 1);
		}
	};

	const fallThrough = (nodes, callerProps, readProps, directives) => {
		const root = nodes.find((x) => x.type === "element");
		if (!root) return;
		for (const [k, v] of Object.entries(callerProps)) {
			if (/^\d+$/.test(k) || (readProps && readProps.has(k)) || readProps === null) continue;
			if (!(k in root.properties)) root.properties[k] = v;
		}
		Object.assign(root.data.directives, directives);
	};

	// ###################
	// Every render of a file is one use, with its own exported values
	// ###################
	const run = async (id, props, slot, parent) => {
		onRun?.(id);
		const result = await load(id);
		const use = { id: uses.length, module: id, parent, values: {} };
		uses.push(use);
		const am = {
			scope: (p) => Object.freeze({
				version,
				props: () => p,
				defineRef: runtimeOnly("defineRef"),
				ref: runtimeOnly("ref"),
				refs: runtimeOnly("refs")
			}),
			text: (value) => ({ type: "text", value }),
			comment: (T, value) => {
				if (!removeComments) T.push({ type: "comment", value });
			},
			el: (tagName, properties, children, directives, position) => ({
				type: "element",
				tagName,
				properties,
				children,
				data: { directives: { ...directives }, use: use.id, source: id, position }
			}),
			runtime: (code, range, kind, codeStart, afterWord = false) => ({ type: "runtime", code, range, kind, codeStart, afterWord, source: id, use: use.id }),
			emit,
			emitCheck: (T, v, label, position) => {
				if (v === undefined) {
					const missing = /^[A-Za-z_$][\w$]*$/.test(label) && result.readProps?.has(label) && !(label in props);
					warn(id, position, `\${ ${label} }$ is undefined${missing ? ` (prop "${label}" wasn't passed)` : ""}`);
				}
				emit(T, v);
			},
			export: (values) => Object.assign(use.values, values),
			component: async (childId, childProps, childSlot, directives) => {
				const nodes = await run(childId, childProps, childSlot, use.id);
				fallThrough(nodes, childProps, compiled.get(childId).readProps, directives);
				dropFinalBreak(nodes);
				return nodes;
			}
		};
		return withTimeout(result.render(am, props, slot), timeout, id);
	};

	try {
		const children = await run(graph.entry, pageProps, null, null);
		const tree = { type: "root", children };
		scopeStyles(tree, graph).forEach((w) => warn(w.source, w.position, w.message));
		const modules = new Map([...compiled].map(([id, r]) => [id, { staticNames: r.staticNames, exportNames: r.exportNames, loopNames: r.loopNames, src: graph.modules.get(id)?.src }]));
		return { tree, uses, modules, warnings };
	} catch (err) {
		rethrow(err);
	}
}
