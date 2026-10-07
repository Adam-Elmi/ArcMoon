// ###################
// Node.js runtime build: bundle the prepared runtime code with esbuild
// Inline (one page, one string) or files (many pages, shared chunks)
// ###################

import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import prepareRuntime, { RuntimeError } from "../core/runtime.js";

export { RuntimeError };

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(HERE, "../runtime");
const CLIENT = resolve(RUNTIME_DIR, "client.js");
const REACTIVE = resolve(RUNTIME_DIR, "reactive.js");
const BUILTINS = new Set(builtinModules);

// ###################
// Absolute path of a [script = src] file: "/x.js" is from the project root
// ###################
const scriptPath = (script, cwd) =>
	script.src.startsWith("/") ? resolve(cwd, `.${script.src}`) : resolve(isAbsolute(script.source) ? dirname(script.source) : cwd, script.src);

// ###################
// One esbuild plugin for any number of pages; pages is keyed by page index
// ###################
const pluginFor = (pages, { allowed, version, cwd, dev }) => {
	const allowedSet = new Set(allowed);
	const checked = (a) =>
		a.namespace === "arcm" ||
		(a.importer && !a.importer.includes(`${sep}node_modules${sep}`) && !a.importer.startsWith(RUNTIME_DIR));

	return {
		name: "arcmoon",
		setup(b) {
			b.onResolve({ filter: /^arcm-(entry|file):/ }, (a) => ({ path: a.path, namespace: "arcm" }));
			b.onLoad({ filter: /^arcm-entry:/, namespace: "arcm" }, (a) => {
				const page = pages[Number(a.path.slice("arcm-entry:".length))];
				const { prepared } = page;
				const contents = prepared.entry({
					client: CLIENT,
					fileSpecs: prepared.files.map((_, i) => `arcm-file:${page.index}:${i}`),
					scriptSpecs: prepared.scripts.map((s) => scriptPath(s, cwd)),
					version,
					label: (id) => (isAbsolute(id) ? relative(cwd, id).split(sep).join("/") : id)
				});
				return { contents, loader: "js", resolveDir: cwd };
			});
			b.onLoad({ filter: /^arcm-file:/, namespace: "arcm" }, (a) => {
				const [p, i] = a.path.slice("arcm-file:".length).split(":").map(Number);
				const f = pages[p].prepared.files[i];
				return { contents: pages[p].prepared.sourceOf(f, { map: dev, name: isAbsolute(f.id) ? relative(cwd, f.id).split(sep).join("/") : f.id }), loader: "js", resolveDir: isAbsolute(f.id) ? dirname(f.id) : cwd };
			});
			b.onResolve({ filter: /^arcmoon\/reactive$/ }, () => ({ path: REACTIVE }));
			b.onResolve({ filter: /^[^./]/ }, (a) => {
				if (/^arcm-/.test(a.path) || isAbsolute(a.path) || !checked(a)) return;
				const pkg = a.path.startsWith("@") ? a.path.split("/").slice(0, 2).join("/") : a.path.split("/")[0];
				const detail = { spec: a.path, importer: a.importer };
				if (a.path.startsWith("node:") || BUILTINS.has(pkg)) {
					return { errors: [{ text: `runtime import "${a.path}" is a Node.js module, which doesn't exist in the browser`, detail }] };
				}
				if (!allowedSet.has(pkg)) {
					return { errors: [{ text: `runtime import "${pkg}" is not listed in bundle (arcmoon.config.js)`, detail }] };
				}
			});
		}
	};
};

// ###################
// esbuild errors pointed at the .arcm file or the [script] file
// ###################
const toError = (err, pages) => {
	const first = err.errors?.[0];
	if (!first) return err;
	const importer = first.detail?.importer ?? first.location?.file ?? "";
	const match = /arcm-file:(\d+):(\d+)/.exec(importer);
	if (match) {
		const { prepared } = pages[Number(match[1])];
		const file = prepared.files[Number(match[2])];
		return new RuntimeError(first.text, file.id, first.detail ? prepared.importPosition(file, first.detail.spec) : null);
	}
	if (first.location?.file && !first.location.file.startsWith("arcm")) {
		const where = { line: first.location.line - 1, character: first.location.column };
		return new RuntimeError(first.text, resolve(first.location.file), where);
	}
	return new RuntimeError(first.text, "runtime bundle");
};

// ###################
// Every [script = src] file must exist
// ###################
const checkScripts = (pages, cwd) => {
	for (const { prepared } of Object.values(pages)) {
		for (const s of prepared.scripts) {
			if (!existsSync(scriptPath(s, cwd))) throw new RuntimeError(`can't find script "${s.src}"`, s.source, s.position);
		}
	}
};

// ###################
// Inline: one page, one minified script string
// dev: not minified, with a source map back to the .arcm files
// ###################
export default async function buildRuntime(result, options = {}) {
	const { bundle: allowed = [], version = "0.0.0", cwd = process.cwd(), dev = false } = options;
	const prepared = prepareRuntime(result);
	if (!prepared.hasCode) return { js: null, warnings: prepared.warnings };

	const pages = { 0: { index: 0, prepared } };
	checkScripts(pages, cwd);
	try {
		const out = await build({
			entryPoints: ["arcm-entry:0"],
			bundle: true,
			write: false,
			format: "esm",
			platform: "browser",
			minify: !dev,
			sourcemap: dev ? "inline" : false,
			logLevel: "silent",
			absWorkingDir: cwd,
			plugins: [pluginFor(pages, { allowed, version, cwd, dev })]
		});
		return { js: out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"), warnings: prepared.warnings };
	} catch (err) {
		throw toError(err, pages);
	}
}

// ###################
// Files: many pages in one build; shared code goes to chunks
// pages: [{ name, prepared }] → { entries: Map(name → file path), files: [{ path, contents }] }
// ###################
export async function bundlePages(list, options = {}) {
	const { bundle: allowed = [], version = "0.0.0", cwd = process.cwd(), outDir = cwd, assetsDir = "assets", dev = false } = options;
	const pages = {};
	list.forEach((p, index) => {
		if (p.prepared.hasCode) pages[index] = { ...p, index };
	});
	if (!Object.keys(pages).length) return { entries: new Map(), files: [] };

	checkScripts(pages, cwd);
	let out;
	try {
		out = await build({
			entryPoints: Object.values(pages).map((p) => ({ in: `arcm-entry:${p.index}`, out: p.name })),
			bundle: true,
			splitting: true,
			write: false,
			format: "esm",
			platform: "browser",
			minify: !dev,
			sourcemap: dev ? "inline" : false,
			logLevel: "silent",
			absWorkingDir: cwd,
			outdir: resolve(outDir, assetsDir),
			entryNames: "[name]-[hash]",
			chunkNames: "chunks/[name]-[hash]",
			metafile: true,
			plugins: [pluginFor(pages, { allowed, version, cwd, dev })]
		});
	} catch (err) {
		throw toError(err, pages);
	}

	const entries = new Map();
	for (const [file, meta] of Object.entries(out.metafile.outputs)) {
		const match = meta.entryPoint && /arcm-entry:(\d+)/.exec(meta.entryPoint);
		if (match) entries.set(list[Number(match[1])].name, resolve(cwd, file));
	}
	return { entries, files: out.outputFiles.map((f) => ({ path: f.path, contents: f.text })) };
}
