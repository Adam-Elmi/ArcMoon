// ###################
// ArcMoon compiler: .arcm source to an HTML string
// ###################

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, join, relative, basename, sep } from "node:path";
import { toHtml } from "hast-util-to-html";
import loadModules from "../core/modules.js";
import evaluate from "./evaluator.js";
import buildRuntime, { bundlePages } from "./runtime.js";
import prepareRuntime from "../core/runtime.js";
import bundleStyles from "./styles.js";
import { collectStyles, addStyle, addStyleHref } from "../core/css.js";
import { check } from "./protector.js";
import unknownTags from "../core/tags.js";
import { toHast, addScript, addScriptSrc, writeExact, CompilerError, formatWarning } from "../core/html.js";

export { CompilerError };
import pkg from "../package.json" with { type: "json" };

// ###################
// "pkg/File.arcm" is looked up in node_modules, like Node does
// ###################
const fromNodeModules = (path, from) => {
	let dir = dirname(from);
	while (true) {
		const file = join(dir, "node_modules", path);
		if (existsSync(file)) return file;
		const up = dirname(dir);
		if (up === dir) return resolve(dirname(from), "node_modules", path);
		dir = up;
	}
};

// ###################
// Load the [import] tree; lexes and parses only, runs nothing
// ###################
export const loadGraph = (options = {}) => {
	const { src, filename, importAliases = {}, cwd = process.cwd() } = options;
	if (src === undefined && !filename) throw new TypeError("ArcMoon: pass src or filename");

	const id = filename ? resolve(cwd, filename) : resolve(cwd, "anonymous.arcm");
	const aliases = Object.fromEntries(
		Object.entries(importAliases).map(([alias, target]) => [alias, resolve(cwd, target)])
	);
	const host = {
		resolve: (path, from) => {
			if (isAbsolute(path)) return path;
			if (path.startsWith(".")) return resolve(dirname(from), path);
			return fromNodeModules(path, from);
		},
		readFile: (file) => readFile(file, "utf8")
	};
	return loadModules({ id, src }, host, { importAliases: aliases });
};

const HTML_OPTIONS = { allowDangerousHtml: true, characterReferences: { useNamedReferences: true } };
const defaultWarning = (w) => console.warn(formatWarning(w));

// ###################
// One page up to the page tree: load, warnings, protector, ${ }$
// ###################
const evaluatePage = async (options) => {
	const { props = {}, removeComments = true, timeout = 5000, cwd = process.cwd(), root = cwd, onWarning = defaultWarning, worker } = options;
	const graph = await loadGraph(options);
	unknownTags(graph).forEach((w) => onWarning(w));
	await check(graph, { root });
	const result = await evaluate(graph, { props, removeComments, timeout, version: pkg.version, cwd, worker });
	result.warnings.forEach((w) => onWarning(w));
	return result;
};

// ###################
// URL of a bundled file from a page: relative to the page, or from base
// ###################
const urlOf = (file, name, { outDir, base }) => {
	const path = base
		? `${base.replace(/\/?$/, "/")}${relative(outDir, file).split(sep).join("/")}`
		: relative(dirname(resolve(outDir, `${name}.html`)), file).split(sep).join("/");
	return path.startsWith(".") || path.startsWith("/") ? path : `./${path}`;
};

// ###################
// Many pages at once
// shared: { outDir, assetsDir, base, bundle, cwd, externalScripts, externalStyles, dev }
//   dev: runtime JS not minified, with source maps to the .arcm files
//   externalScripts (default true): JS as separate files with shared chunks, else inside each page
//   externalStyles (default false): CSS as separate files, else a <style> in each page
// → { pages: [{ name, html }], files: [{ path, contents }] }
// base: URL the assets are served from ("/"); by default URLs are relative to each page
// ###################
export async function buildPages(list, shared = {}) {
	const cwd = shared.cwd ?? process.cwd();
	const outDir = resolve(cwd, shared.outDir ?? ".");
	const assetsDir = shared.assetsDir ?? "assets";
	const { externalScripts = true, externalStyles = false, bundle = [], dev = false } = shared;

	const pages = [];
	for (const options of list) {
		const onWarning = options.onWarning ?? shared.onWarning ?? defaultWarning;
		const result = await evaluatePage({ cwd, ...options, onWarning });
		const pieces = collectStyles(result.tree);
		const name = options.name ?? (options.filename ? basename(options.filename, ".arcm") : "page");
		const page = { name, result, pieces, onWarning };
		if (externalScripts) {
			page.prepared = prepareRuntime(result);
			page.prepared.warnings.forEach((w) => onWarning(w));
		} else {
			const { js, warnings } = await buildRuntime(result, { bundle, version: pkg.version, cwd, dev });
			warnings.forEach((w) => onWarning(w));
			page.js = js;
		}
		pages.push(page);
	}

	const styles = await bundleStyles(pages, { cwd, outDir, assetsDir, external: externalStyles });
	const sharedWarning = shared.onWarning ?? defaultWarning;
	for (const { page, ...w } of styles.warnings) (page === null ? sharedWarning : pages[page].onWarning)(w);
	const scripts = externalScripts
		? await bundlePages(pages, { bundle, version: pkg.version, cwd, outDir, assetsDir, dev })
		: { entries: new Map(), files: [] };

	return {
		pages: pages.map(({ name, result, js }) => {
			if (styles.css.has(name)) addStyle(result.tree, styles.css.get(name));
			if (styles.entries.has(name)) addStyleHref(result.tree, urlOf(styles.entries.get(name), name, { outDir, base: shared.base }));
			const tree = toHast(result.tree);
			if (js) addScript(tree, js);
			const entry = scripts.entries.get(name);
			if (entry) addScriptSrc(tree, urlOf(entry, name, { outDir, base: shared.base }));
			return { name, html: writeExact(toHtml(tree, HTML_OPTIONS), tree) };
		}),
		files: [...styles.files, ...scripts.files]
	};
}

export default class ArcMoon {
	constructor(options = {}) {
		this.options = options;
	}

	// ###################
	// One HTML string; runtime JS is an inline script, CSS one <style>
	// url() files in CSS are left as written (there is nowhere to copy them)
	// ###################
	async compile() {
		const { bundle = [], cwd = process.cwd(), onWarning = defaultWarning, dev = false } = this.options;
		const result = await evaluatePage(this.options);
		const { css, warnings: cssWarnings } = await bundleStyles([{ name: "page", pieces: collectStyles(result.tree) }], { cwd, copyAssets: false });
		cssWarnings.forEach(({ page, ...w }) => onWarning(w));
		if (css.has("page")) addStyle(result.tree, css.get("page"));
		const { js, warnings } = await buildRuntime(result, { bundle, version: pkg.version, cwd, dev });
		warnings.forEach((w) => onWarning(w));
		const tree = toHast(result.tree);
		if (js) addScript(tree, js);
		return writeExact(toHtml(tree, HTML_OPTIONS), tree);
	}

	// ###################
	// HTML plus files: { html, files: [{ path, contents }] }
	// ###################
	async build(shared = {}) {
		const { pages, files } = await buildPages([this.options], { bundle: this.options.bundle, cwd: this.options.cwd, dev: this.options.dev, ...shared });
		return { html: pages[0].html, files };
	}
}
