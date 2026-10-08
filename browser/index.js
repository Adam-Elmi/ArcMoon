// ###################
// ArcMoon in the browser: render() → DOM, compile() → HTML string
// The compile runs in a Web Worker; runtime code runs in this page
// ###################

import { toHtml } from "hast-util-to-html";
import { toDom } from "hast-util-to-dom";
import { fromHtml } from "hast-util-from-html";
import prepareRuntime from "../core/runtime.js";
import { toHast, addScript, writeExact, setExact, CompilerError, formatWarning } from "../core/html.js";
import { createHost, toId } from "./host.js";
import { createLoader } from "./modules.js";
import * as reactive from "../runtime/reactive.js";
import { run } from "../runtime/client.js";
import pkg from "../package.json" with { type: "json" };

export { CompilerError };

const blobURL = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
const HTML_OPTIONS = { allowDangerousHtml: true, characterReferences: { useNamedReferences: true } };

let sharedWorker = null;
let nextMessage = 0;
let nextRender = 0;

// ###################
// Workers ArcMoon starts say "ready" once loaded. Until then nothing is sent,
// and no timeout runs. A worker passed in with the worker option is used as it is
// ###################
const START_LIMIT = 60000;
const readiness = new WeakMap();

const workerError = (message) => Object.assign(new Error(message), { name: "WorkerError" });

const watchStart = (worker, url) => {
	const ready = new Promise((resolve, reject) => {
		const done = (error) => {
			clearTimeout(timer);
			worker.removeEventListener("message", onMessage);
			worker.removeEventListener("error", onError);
			if (!error) return resolve();
			worker.terminate?.();
			if (worker === sharedWorker) sharedWorker = null;
			reject(error);
		};
		const onMessage = (event) => {
			if (event.data?.ready) done(null);
		};
		const onError = (event) => done(workerError(`couldn't start ArcMoon's worker (${url})${event?.message ? `: ${event.message}` : ""}`));
		const timer = setTimeout(() => done(workerError(`ArcMoon's worker (${url}) didn't start within ${START_LIMIT / 1000} s`)), START_LIMIT);
		worker.addEventListener("message", onMessage);
		worker.addEventListener("error", onError);
	});
	ready.catch(() => {});
	readiness.set(worker, ready);
	return worker;
};

// ###################
// One worker for the page, started on first use. Browsers only start workers from the page's
// own origin, so from a CDN it starts as a same-origin blob: file that imports the CDN's worker.js
// ###################
const startWorker = () => {
	const url = new URL("./worker.js", import.meta.url);
	if (typeof location === "undefined" || url.origin === location.origin) return watchStart(new Worker(url, { type: "module" }), url.href);
	const blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" });
	return watchStart(new Worker(URL.createObjectURL(blob), { type: "module" }), url.href);
};

const defaultWorker = () => {
	sharedWorker ??= startWorker();
	return sharedWorker;
};

// ###################
// A worker stuck in ${ }$ (while (true) {}) never answers: after the timeout (plus a little,
// so the worker's own timeout can answer first) it is terminated, and the next compile starts a new one.
// The timeout starts once the worker is ready
// ###################
const ask = async (worker, request) => {
	await readiness.get(worker);
	return new Promise((resolve, reject) => {
		const id = nextMessage++;
		let timer = null;
		const onMessage = (event) => {
			if (event.data?.id !== id) return;
			clearTimeout(timer);
			worker.removeEventListener("message", onMessage);
			if (event.data.ok) resolve(event.data.result);
			else reject(Object.assign(new Error(event.data.error.message), { name: event.data.error.name }));
		};
		worker.addEventListener("message", onMessage);
		if (request.timeout) {
			timer = setTimeout(() => {
				worker.removeEventListener("message", onMessage);
				worker.terminate?.();
				if (worker === sharedWorker) sharedWorker = null;
				reject(Object.assign(new Error(`\${ }$ code took longer than ${request.timeout} ms and was stopped`), { name: "EvaluatorError" }));
			}, request.timeout + 500);
		}
		worker.postMessage({ id, request });
	});
};

// ###################
// { raw } HTML becomes real elements
// ###################
// ###################
// <template>: hast-util-to-dom ignores "content", so the inside goes in as children,
// then moves into each template's real content once the DOM is built
// ###################
const templatesToChildren = (node) => {
	if (node.content) {
		node.children = node.content.children;
		delete node.content;
	}
	for (const c of node.children ?? []) templatesToChildren(c);
};

const fillTemplates = (root) => {
	for (const t of root.querySelectorAll("template")) {
		fillTemplates(t);
		while (t.firstChild) t.content.appendChild(t.firstChild);
	}
};

const parseRaw = (node) => {
	if (!node.children) return;
	node.children = node.children.flatMap((c) => {
		if (c.type === "raw") return fromHtml(c.value, { fragment: true }).children;
		parseRaw(c);
		return [c];
	});
};

export default class ArcMoon {
	constructor(options = {}) {
		this.options = options;
	}

	// ###################
	// Compile in the worker; returns the tree and the prepared runtime code
	// ###################
	async #build() {
		const {
			src,
			filename,
			files = {},
			baseUrl = null,
			packages = {},
			props = {},
			env = {},
			importAliases = {},
			removeComments = true,
			timeout = 5000,
			worker = defaultWorker(),
			onWarning = (w) => console.warn(formatWarning(w))
		} = this.options;
		if (src === undefined && !filename) throw new TypeError("ArcMoon: pass src or filename");

		const request = { src, filename, files, baseUrl, packages, props, env, importAliases, removeComments, timeout, version: pkg.version };
		const result = await ask(worker, request);
		const prepared = prepareRuntime(result);
		[...result.warnings, ...prepared.warnings].forEach((w) => onWarning(w));
		return { result, prepared: prepared.hasCode ? prepared : null };
	}

	// ###################
	// Module URLs for the runtime code of one page
	// ###################
	async #runtimeModules(prepared, dom) {
		const { files = {}, baseUrl = null, packages = {}, toModuleURL = blobURL } = this.options;
		globalThis.__arcmClient = { run };
		globalThis.__arcmReactive = reactive;

		const special = {
			"arcmoon/reactive": toModuleURL(`const m = globalThis.__arcmReactive; export const { signal, computed, effect } = m;`)
		};
		const host = createHost({ files, baseUrl });
		const loader = createLoader({ host, packages, toModuleURL, special, node: false });
		const client = toModuleURL(`export const run = (...a) => globalThis.__arcmClient.run(...a);`);

		const fileSpecs = [];
		for (const f of prepared.files) {
			try {
				fileSpecs.push(await loader.moduleURL(prepared.sourceOf(f), toId(f.id)));
			} catch (err) {
				throw new CompilerError(err.message, f.id, err.spec ? prepared.importPosition(f, err.spec) : null);
			}
		}
		// ###################
		// [script = src] files load like runtime code: from files or baseUrl
		// ###################
		const scriptSpecs = [];
		for (const s of prepared.scripts) {
			const id = host.resolve(s.src, toId(s.source));
			try {
				scriptSpecs.push(await loader.moduleURL(await host.readFile(id), id));
			} catch (err) {
				throw new CompilerError(`can't load script "${s.src}": ${err.message}`, s.source, s.position);
			}
		}
		return prepared.entry({ client, fileSpecs, scriptSpecs, version: pkg.version, dom });
	}

	// ###################
	// HTML string; runtime code is an inline script using blob: URLs of this page
	// ###################
	async compile() {
		const { result, prepared } = await this.#build();
		const tree = toHast(result.tree);
		if (prepared) addScript(tree, await this.#runtimeModules(prepared, null));
		return writeExact(toHtml(tree, HTML_OPTIONS), tree);
	}

	// ###################
	// Real DOM; runtime code runs right after you insert the fragment
	// ###################
	async render() {
		const { result, prepared } = await this.#build();
		const { toModuleURL = blobURL } = this.options;
		const tree = toHast(result.tree);
		templatesToChildren(tree);
		parseRaw(tree);
		const fragment = toDom(tree, { fragment: true, document });
		setExact(fragment, tree);
		fillTemplates(fragment);

		if (prepared) {
			// ###################
			// Refs point at the built elements; the lookup attribute is removed
			// ###################
			const byRef = new Map();
			for (const el of fragment.querySelectorAll("[data-arcm-ref]")) {
				const id = el.getAttribute("data-arcm-ref");
				if (!byRef.has(id)) byRef.set(id, []);
				byRef.get(id).push(el);
				el.removeAttribute("data-arcm-ref");
			}
			const comments = new Map();
			const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				if (n.data.startsWith("arcm:")) comments.set(n.data.slice(5), n);
			}

			const key = `r${nextRender++}`;
			globalThis.__arcmDom ??= {};
			globalThis.__arcmDom[key] = { byRef: (id) => byRef.get(id) ?? [], liveComment: (id) => comments.get(id) };
			const entry = toModuleURL(await this.#runtimeModules(prepared, `globalThis.__arcmDom[${JSON.stringify(key)}]`));

			setTimeout(() => {
				import(/* @vite-ignore */ entry).catch((err) => console.error("ArcMoon runtime error", err));
			}, 0);
		}
		return fragment;
	}
}
