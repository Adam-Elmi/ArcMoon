// ###################
// ArcMoon protector: report what templates do, run nothing untrusted
// ###################

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import * as acorn from "acorn";
import { NODE_TYPES as N } from "../core/parser.js";

const TRUST_FILE = "arcmoon.trust.json";
const BUILTINS = new Set(builtinModules);
const RISKY = new Set(["child_process", "net", "dgram", "tls", "vm", "worker_threads", "cluster", "module"]);
const FS_WRITES = new Set([
	"writeFile", "writeFileSync", "appendFile", "appendFileSync", "rm", "rmSync", "rmdir", "rmdirSync",
	"unlink", "unlinkSync", "rename", "renameSync", "mkdir", "mkdirSync", "copyFile", "copyFileSync",
	"cp", "cpSync", "createWriteStream", "chmod", "chmodSync", "chown", "chownSync", "symlink", "symlinkSync", "truncate", "truncateSync"
]);
const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true };

export class ProtectorError extends Error {
	constructor(message, templates = []) {
		super(message);
		this.name = "ProtectorError";
		this.templates = templates;
	}
}

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

const parseJS = (code) => {
	try {
		const probe = acorn.parse(`(${code}\n)`, ACORN);
		if (probe.body.length === 1 && probe.body[0].type === "ExpressionStatement") return probe;
	} catch {}
	try {
		return acorn.parse(code, ACORN);
	} catch {
		return null;
	}
};

// ###################
// process, also as globalThis.process / global.process; property names, also computed ["name"]
// ###################
const GLOBAL_NAMES = new Set(["globalThis", "global", "window", "self"]);
const PROCESS = new Set(["process"]);
const FETCH = new Set(["fetch"]);
const NATIVE = new Set(["getBuiltinModule", "binding", "_linkedBinding", "dlopen"]);
const propName = (m) => (m.computed ? (m.property.type === "Literal" ? String(m.property.value) : null) : m.property.name);

const packageName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
const isBare = (spec) => !/^(\.|\/|[a-z]+:)/i.test(spec) || spec.startsWith("node:");

const emptyReport = () => ({
	imports: new Set(),
	risky: new Set(),
	localScripts: new Set(),
	fetch: new Set(),
	env: new Set(),
	remote: new Set(),
	dynamic: [],
	runtimeBlocks: 0,
	scriptTags: 0,
	runtimeImports: new Set(),
	runtimeRemote: new Set(),
	exports: []
});

// ###################
// Read one ${ }$ code piece
// ###################
const scanStatic = (code, file, pos, report, packages, { exports = true } = {}) => {
	const ast = parseJS(code);
	if (!ast) return;
	const where = (loc) => `${file}:${pos.line + loc.line}:${loc.line === 1 ? pos.character + loc.column + 3 : loc.column + 1}`;

	const addImport = (spec, names, isNamespace) => {
		if (isBare(spec)) {
			const name = spec.startsWith("node:") ? spec.slice(5).split("/")[0] : packageName(spec);
			const builtin = spec.startsWith("node:") || BUILTINS.has(name);
			if (builtin && (name === "fs" || spec.includes("fs/promises"))) {
				const writes = isNamespace || names.some((x) => FS_WRITES.has(x));
				report.imports.add(`node:fs (${writes ? "read/write" : "read"})`);
				if (writes) report.risky.add("fs (write)");
			} else if (builtin) {
				report.imports.add(`node:${name}`);
				if (RISKY.has(name)) report.risky.add(name);
			} else {
				report.imports.add(name);
				packages.add(name);
			}
		} else if (/^https?:/.test(spec)) {
			report.remote.add(spec);
		} else {
			report.localScripts.add(resolve(dirname(file), spec));
		}
	};

	// ###################
	// Parents, and the names that stand for process / process.env (import … from "node:process")
	// ###################
	const parents = new Map();
	walk(ast, (n, p) => parents.set(n, p));
	const processNames = new Set(["process"]);
	const envNames = new Set();
	for (const s of ast.body) {
		if (s.type !== "ImportDeclaration" || !/^(node:)?process$/.test(s.source.value)) continue;
		for (const sp of s.specifiers) {
			if (sp.type !== "ImportSpecifier") processNames.add(sp.local.name);
			else if ((sp.imported.name ?? sp.imported.value) === "env") envNames.add(sp.local.name);
		}
	}

	// ###################
	// A name used as a value: not a key, a property name, or the template's own declaration
	// ###################
	const isValue = (n) => {
		const p = parents.get(n);
		if (!p) return true;
		if (p.type === "MemberExpression" && p.property === n && !p.computed) return false;
		if ((p.type === "Property" || p.type === "PropertyDefinition" || p.type === "MethodDefinition") && p.key === n && !p.computed) return p.type === "Property" && p.shorthand && p.value === n;
		if ((p.type === "VariableDeclarator" || p.type === "ClassDeclaration") && p.id === n) return false;
		if (/Function/.test(p.type) && (p.id === n || p.params.includes(n))) return false;
		if (/^(Import|Export)/.test(p.type)) return false;
		return true;
	};
	// ###################
	// A name the template declares itself (a parameter, const, function …) around this spot
	// ###################
	const names = (pattern, out = new Set()) => {
		if (!pattern) return out;
		if (pattern.type === "Identifier") out.add(pattern.name);
		else if (pattern.type === "ObjectPattern") pattern.properties.forEach((q) => names(q.type === "RestElement" ? q.argument : q.value, out));
		else if (pattern.type === "ArrayPattern") pattern.elements.forEach((e) => names(e, out));
		else if (pattern.type === "RestElement") names(pattern.argument, out);
		else if (pattern.type === "AssignmentPattern") names(pattern.left, out);
		return out;
	};
	const declares = (statement, name) =>
		(statement.type === "VariableDeclaration" && statement.declarations.some((d) => names(d.id).has(name))) ||
		((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id?.name === name);
	const shadowed = (n) => {
		for (let a = parents.get(n); a; a = parents.get(a)) {
			if (/Function/.test(a.type) && a.params.some((q) => names(q).has(n.name))) return true;
			if ((a.type === "BlockStatement" || a.type === "Program") && a.body.some((st) => declares(st, n.name))) return true;
		}
		return false;
	};
	const globalProp = (n, names) => n.type === "MemberExpression" && n.object.type === "Identifier" && GLOBAL_NAMES.has(n.object.name) && names.has(propName(n));
	const isProcessRef = (n) =>
		(n?.type === "Identifier" && processNames.has(n.name) && isValue(n) && (n.name !== "process" || !shadowed(n))) || (n?.type === "MemberExpression" && globalProp(n, PROCESS));
	const isFetchRef = (n) => (n.type === "Identifier" && n.name === "fetch" && isValue(n) && !shadowed(n)) || globalProp(n, FETCH);

	// ###################
	// process.env.NAME, process.env["NAME"], const { A } = process.env; anything else is all of it
	// ###################
	const envAccess = (node) => {
		const p = parents.get(node);
		if (p?.type === "MemberExpression" && p.object === node) report.env.add(propName(p) ?? "(computed name)");
		else if (p?.type === "VariableDeclarator" && p.init === node && p.id.type === "ObjectPattern") {
			p.id.properties.forEach((q) => report.env.add(q.type === "RestElement" ? "(all)" : q.key.name ?? q.key.value));
		} else report.env.add("(all)");
	};

	// ###################
	// Every use of process: .env is read, .cwd() and the like are fine, anything else is reported
	// ###################
	const processUse = (ref) => {
		const p = parents.get(ref);
		if (p?.type === "MemberExpression" && p.object === ref) {
			const name = propName(p);
			if (name === "env") return envAccess(p);
			if (name !== null) return;
			report.env.add("(all)");
			report.dynamic.push(`process[…] with a computed name at ${where(ref.loc.start)}`);
			return;
		}
		report.env.add("(all)");
		report.dynamic.push(`process used indirectly at ${where(ref.loc.start)}`);
	};

	// ###################
	// Every use of fetch: a call reports its host, anything else any host
	// ###################
	const fetchUse = (ref) => {
		const p = parents.get(ref);
		if (p?.type === "CallExpression" && p.callee === ref) {
			const a = p.arguments[0];
			const text = a?.type === "Literal" ? a.value : a?.type === "TemplateLiteral" ? a.quasis[0].value.cooked : null;
			try {
				report.fetch.add(new URL(text).host);
			} catch {
				report.fetch.add(`unknown host (${where(ref.loc.start)})`);
			}
		} else {
			report.fetch.add(`any host (fetch used indirectly at ${where(ref.loc.start)})`);
		}
	};

	const readsEnv = (node) => {
		let found = false;
		walk(node, (x) => {
			if (x.type === "Identifier" && envNames.has(x.name) && isValue(x)) found = true;
			if (!isProcessRef(x)) return;
			const p = parents.get(x);
			if (!(p?.type === "MemberExpression" && p.object === x) || propName(p) === "env" || propName(p) === null) found = true;
		});
		return found;
	};

	walk(ast, (n) => {
		if (isProcessRef(n)) processUse(n);
		else if (n.type === "Identifier" && envNames.has(n.name) && isValue(n)) envAccess(n);
		else if (isFetchRef(n)) fetchUse(n);

		if (n.type === "ImportDeclaration") {
			const names = n.specifiers.map((s) => (s.type === "ImportSpecifier" ? s.imported.name : "*"));
			addImport(n.source.value, names, names.includes("*"));
		} else if (n.type === "ImportExpression") {
			if (n.source.type === "Literal") addImport(n.source.value, [], true);
			else report.dynamic.push(`import() with a computed name at ${where(n.loc.start)}`);
		} else if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && isProcessRef(n.callee.object) && NATIVE.has(propName(n.callee))) {
			// ###################
			// Node access without an import: process.getBuiltinModule("x"), process.binding, process.dlopen
			// ###################
			const name = propName(n.callee);
			const a = n.arguments[0];
			if (name !== "getBuiltinModule") report.risky.add(`process.${name === "_linkedBinding" ? "binding" : name}`);
			else if (a?.type === "Literal" && typeof a.value === "string") addImport(a.value.startsWith("node:") ? a.value : `node:${a.value}`, [], true);
			else report.dynamic.push(`process.getBuiltinModule() with a computed name at ${where(n.loc.start)}`);
		} else if (n.type === "CallExpression" && ((n.callee.type === "Identifier" && n.callee.name === "createRequire") || (n.callee.type === "MemberExpression" && propName(n.callee) === "createRequire"))) {
			report.risky.add("createRequire");
		} else if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "require") {
			const a = n.arguments[0];
			if (a?.type === "Literal" && typeof a.value === "string") addImport(a.value, [], true);
			else report.dynamic.push(`require() with a computed name at ${where(n.loc.start)}`);
		} else if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "eval") {
			report.dynamic.push(`eval() at ${where(n.loc.start)}`);
		} else if ((n.type === "CallExpression" || n.type === "NewExpression") && n.callee.type === "Identifier" && n.callee.name === "Function") {
			report.dynamic.push(`Function() at ${where(n.loc.start)}`);
		} else if (exports && n.type === "ExportNamedDeclaration" && n.declaration?.type === "VariableDeclaration") {
			for (const d of n.declaration.declarations) {
				if (d.id.type === "Identifier") report.exports.push({ name: d.id.name, fromEnv: Boolean(d.init && readsEnv(d.init)) });
			}
		}
	});
};

const scanRuntime = (code, file, report, packages) => {
	const ast = parseJS(code);
	if (!ast) return;
	walk(ast, (n) => {
		if (n.type === "ImportDeclaration" && n.source.value.startsWith(".")) {
			report.localScripts.add(resolve(dirname(file), n.source.value));
		} else if (n.type === "ImportDeclaration" && isBare(n.source.value) && !n.source.value.startsWith("arcmoon/")) {
			const name = packageName(n.source.value);
			report.runtimeImports.add(name);
			packages.add(name);
		} else if ((n.type === "ImportDeclaration" || n.type === "ImportExpression") && /^https?:/.test(n.source.value ?? "")) {
			report.runtimeRemote.add(n.source.value);
		}
	});
};

// ###################
// Walk one file's AST and fill its report
// ###################
const scanModule = (mod, report, packages, root) => {
	const statics = (v) => v && typeof v === "object" && v.type === N.STATIC_LOGIC;
	const runtimes = (v) => v && typeof v === "object" && v.type === N.RUNTIME_LOGIC;

	const visit = (nodes, top) => {
		for (const node of nodes) {
			if (node.type === N.IMPORT && /^https?:/.test(node.path)) report.remote.add(node.path);

			// ###################
			// A local [script = src] file ships to visitors: report it and hash it
			// ###################
			const src = node.props?.src;
			if (node.type === N.BLOCK && node.id.toLowerCase() === "script" && typeof src === "string" && !/^([a-z][a-z\d+.-]*:|\/\/)/i.test(src)) {
				report.localScripts.add(src.startsWith("/") ? resolve(root, `.${src}`) : resolve(dirname(mod.id), src));
				report.scriptTags++;
			}
			if (node.type === N.STATIC_LOGIC) scanStatic(node.code, mod.id, node.range.start, report, packages);
			if (node.type === N.RUNTIME_LOGIC) {
				if (top) report.runtimeBlocks++;
				scanRuntime(node.code, mod.id, report, packages);
			}
			for (const v of Object.values(node.props ?? {})) {
				if (statics(v)) scanStatic(v.code, mod.id, v.range.start, report, packages);
				if (runtimes(v)) scanRuntime(v.code, mod.id, report, packages);
			}
			if (node.type === N.FOR_EACH && statics(node.source)) scanStatic(node.source.code, mod.id, node.source.range.start, report, packages);
			if (node.body) visit(node.body, false);
		}
	};
	visit(mod.ast, true);
};

// ###################
// Installed version of a package, looked up from a file's folder
// ###################
const versionOf = async (name, fromFile) => {
	let dir = dirname(fromFile);
	while (true) {
		const pkg = join(dir, "node_modules", name, "package.json");
		if (existsSync(pkg)) return JSON.parse(await readFile(pkg, "utf8")).version ?? "unknown";
		const up = dirname(dir);
		if (up === dir) return "not installed";
		dir = up;
	}
};

const inside = (file, dir) => file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep);

// ###################
// Group files into your project and third-party templates
// ###################
const templateRoots = (graph, root) => {
	const isOwn = (id) => isAbsolute(id) && inside(id, root) && !id.split(sep).includes("node_modules");
	const rootOf = (id) => {
		const parts = id.split(sep);
		const at = parts.lastIndexOf("node_modules");
		if (at !== -1) {
			const len = parts[at + 1]?.startsWith("@") ? 3 : 2;
			return parts.slice(0, at + len).join(sep);
		}
		return dirname(id);
	};

	const roots = new Set();
	if (!isOwn(graph.entry)) roots.add(rootOf(graph.entry));
	for (const mod of graph.modules.values()) {
		if (!isOwn(mod.id)) continue;
		for (const target of mod.imports.values()) if (!isOwn(target)) roots.add(rootOf(target));
	}

	const groupOf = (id) => {
		if (isOwn(id)) return null;
		let best = null;
		for (const r of roots) if (inside(id, r) && (!best || r.length > best.length)) best = r;
		if (!best) {
			best = rootOf(id);
			roots.add(best);
		}
		return best;
	};
	return { groupOf };
};

const keyOf = (dir, root) => {
	const parts = dir.split(sep);
	const at = parts.lastIndexOf("node_modules");
	if (at !== -1) return parts.slice(at + 1).join("/");
	return relative(root, dir).split(sep).join("/");
};

// ###################
// A local import like Node resolves it: the path, then .js, .mjs, /index.js
// ###################
const resolveLocal = (spec, fromFile) => {
	const base = resolve(dirname(fromFile), spec);
	const isFile = (f) => {
		try {
			return statSync(f).isFile();
		} catch {
			return false;
		}
	};
	return [base, `${base}.js`, `${base}.mjs`, join(base, "index.js")].find(isFile) ?? base;
};

// ###################
// Every file local scripts reach through their own imports (helper.js → deep.js → …),
// and the npm packages they use; files are read, never run
// ###################
const followScripts = async (start, packages) => {
	const seen = new Set();
	const queue = [...start];
	while (queue.length) {
		const file = queue.shift();
		if (seen.has(file)) continue;
		seen.add(file);
		if (!/\.(m?js|cjs)$/.test(file)) continue;
		let code;
		try {
			code = await readFile(file, "utf8");
		} catch {
			continue;
		}
		const ast = parseJS(code);
		if (!ast) continue;
		const take = (spec) => {
			if (typeof spec !== "string") return;
			if (spec.startsWith(".") || spec.startsWith("/")) queue.push(resolveLocal(spec, file));
			else if (isBare(spec) && !spec.startsWith("node:") && !BUILTINS.has(packageName(spec))) packages.add(packageName(spec));
		};
		walk(ast, (n) => {
			if ((n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && n.source) take(n.source.value);
			else if (n.type === "ImportExpression" && n.source.type === "Literal") take(n.source.value);
			else if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "require" && n.arguments[0]?.type === "Literal") take(n.arguments[0].value);
		});
	}
	return seen;
};

// ###################
// Analyze the whole graph; runs no template code
// ###################
export async function analyze(graph, options = {}) {
	const root = resolve(options.root ?? process.cwd());
	const { groupOf } = templateRoots(graph, root);
	const groups = new Map();

	for (const mod of graph.modules.values()) {
		const dir = groupOf(mod.id) ?? "";
		if (!groups.has(dir)) groups.set(dir, { dir, key: dir ? keyOf(dir, root) : null, own: !dir, files: [], report: emptyReport(), packages: new Set() });
		const g = groups.get(dir);
		g.files.push(mod.id);
		scanModule(mod, g.report, g.packages, root);
	}

	for (const g of groups.values()) {
		g.scriptFiles = await followScripts(g.report.localScripts, g.packages);

		// ###################
		// Scan every script reached like ${ }$ code: what helper.js does shows in the report, at its own line
		// ###################
		for (const file of [...g.scriptFiles].sort()) {
			if (!/\.(m?js|cjs)$/.test(file)) continue;
			let code;
			try {
				code = await readFile(file, "utf8");
			} catch {
				continue;
			}
			scanStatic(code, file, { line: 0, character: -2 }, g.report, g.packages, { exports: false });
		}

		const versions = {};
		for (const name of [...g.packages].sort()) versions[name] = await versionOf(name, g.files[0]);
		g.versions = versions;

		// ###################
		// The hash covers the .arcm files, every script they reach, and package versions
		// ###################
		const hash = createHash("sha256");
		const files = [...new Set([...g.files, ...g.scriptFiles])].sort();
		for (const f of files) {
			hash.update(`${g.dir ? relative(g.dir, f) : f}\n`);
			try {
				hash.update(await readFile(f));
			} catch {
				hash.update("(missing)");
			}
			hash.update("\n");
		}
		for (const [name, v] of Object.entries(versions)) hash.update(`${name}@${v}\n`);
		g.hash = `sha256-${hash.digest("hex")}`;
	}

	return { root, own: groups.get("") ?? null, templates: [...groups.values()].filter((g) => !g.own) };
}

// ###################
// arcmoon.trust.json
// ###################
export const readTrust = async (root) => {
	try {
		return JSON.parse(await readFile(join(root, TRUST_FILE), "utf8"));
	} catch {
		return { version: 1, templates: {} };
	}
};

const writeTrust = (root, data) => writeFile(join(root, TRUST_FILE), JSON.stringify(data, null, "\t") + "\n");

// ###################
// The report text for one template
// ###################
export const formatReport = (g) => {
	const r = g.report;
	const rows = [];
	const row = (label, items) => {
		const list = [...items];
		if (list.length) rows.push(`    ${label.padEnd(10)} ${list.join(", ")}`);
	};
	row("import", r.imports);
	row("risky", r.risky);
	row("scripts", [...r.localScripts].map((f) => relative(g.dir || process.cwd(), f)));
	row("fetch", r.fetch);
	row("env", r.env);
	row("remote", r.remote);
	row("dynamic", r.dynamic);
	if (r.runtimeBlocks || r.runtimeImports.size || r.runtimeRemote.size || r.scriptTags) {
		const blocks = `${r.runtimeBlocks} runtime block${r.runtimeBlocks === 1 ? "" : "s"}`;
		const tags = r.scriptTags ? `, ${r.scriptTags} [script] file${r.scriptTags === 1 ? "" : "s"}` : "";
		const ships = r.runtimeImports.size ? `, ships ${[...r.runtimeImports].join(", ")} to visitors` : "";
		const loads = r.runtimeRemote.size ? `, loads ${[...r.runtimeRemote].join(", ")} in visitors' browsers` : "";
		rows.push(`    ${"runtime".padEnd(10)} ${blocks}${tags}${ships}${loads}`);
	}
	row("exports", r.exports.map((e) => (e.fromEnv ? `${e.name} (from process.env!)` : e.name)));
	if (!rows.length) rows.push("    (no code)");
	return rows.join("\n");
};

// ###################
// Stop before running untrusted templates
// ###################
export async function check(graph, options = {}) {
	const result = await analyze(graph, options);
	const trusted = (await readTrust(result.root)).templates ?? {};
	const untrusted = result.templates.filter((g) => trusted[g.key]?.hash !== g.hash);
	if (!untrusted.length) return result;

	const text = untrusted
		.map((g) => {
			const changed = trusted[g.key] ? " has changed since it was trusted" : " is not trusted";
			// a key that climbs out of the project also shows where it is (1.1)
			const where = g.key.startsWith("..") && g.dir ? ` (${g.dir})` : "";
			// the page itself outside the folder where arcmoon runs: that's what makes it a template
			const page = graph.entry && g.files.includes(graph.entry)
				? `\n  ${graph.entry} is outside ${result.root}, so it counts as a template. To build it as your own file, run arcmoon from its folder.`
				: "";
			return `⚠ Template "${g.key}"${where}${changed}. It would:\n${formatReport(g)}\n\n  Review it, then run "arcmoon trust ${g.key}".${page}`;
		})
		.join("\n\n");
	throw new ProtectorError(`${text}\n\n  Nothing was run.`, untrusted);
}

// ###################
// Record the current hashes as trusted
// ###################
export async function trust(graph, options = {}) {
	const result = await analyze(graph, options);
	const only = options.keys ? new Set(options.keys) : null;
	const data = await readTrust(result.root);
	data.templates ??= {};
	const saved = [];
	for (const g of result.templates) {
		if (only && !only.has(g.key)) continue;
		data.templates[g.key] = { hash: g.hash, packages: g.versions, trustedAt: new Date().toISOString() };
		saved.push(g);
	}
	await writeTrust(result.root, data);
	return saved;
}

export async function untrust(keys, options = {}) {
	const root = resolve(options.root ?? process.cwd());
	const data = await readTrust(root);
	const removed = keys.filter((k) => data.templates?.[k]);
	for (const k of removed) delete data.templates[k];
	await writeTrust(root, data);
	return removed;
}
