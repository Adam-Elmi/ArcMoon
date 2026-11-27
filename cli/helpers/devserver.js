// ###################
// In-memory development server: compile pages on demand and reload on changes
// ###################

import http from "node:http";
import fs, { readFileSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { compile } from "./compile.js";
import { arcmFiles } from "./file.js";
import { getResolvedConfigPath, loadConfig } from "./config.js";
import { sharedWorker } from "../../node/evaluator.js";
import { dim, reportError } from "./report.js";
import { CONFIG_FILE } from "../constants.js";

const reloadScript = '<script>new EventSource("/__arcmoon/reload").onmessage=()=>location.reload()</script>';
const logo = `data:image/svg+xml;base64,${readFileSync(new URL("../../assets/arcmoon-new-logo.svg", import.meta.url)).toString("base64")}`;
const errorPage = (message) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArcMoon compile error</title><style>
:root{color-scheme:dark;--ink:#e6e8eb;--muted:#9a9da5;--line:#2a2c30;--red:#ff7278;--page:#0d0e10}*{box-sizing:border-box}body{min-height:100vh;margin:0;padding:24px;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 35%,#17191d 0,#0d0e10 72%);color:var(--ink);font:14px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(100%,760px);overflow:hidden;background:#131416;border:1px solid #292b2f;border-radius:10px;box-shadow:0 24px 80px #0005}.windowbar{height:44px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;background:#17181b;border-bottom:1px solid #292b2f}.brand{display:flex;align-items:center;gap:9px;color:#d6d8dd;font-size:13px;font-weight:600}.logo{display:block;width:22px;height:22px;object-fit:contain}.context{color:#777b84;font:10px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em}.head{display:flex;align-items:flex-start;gap:14px;padding:30px 32px 0}.icon{width:28px;height:28px;flex:none;display:grid;place-items:center;border:1px solid #653538;border-radius:7px;background:#321e20;color:#ff8888;font-size:16px;font-weight:700}.eyebrow{margin:0 0 5px;color:#ff8888;font:600 10px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.1em}h1{margin:0;color:#f1f1f2;font-size:20px;font-weight:550;line-height:1.35;letter-spacing:-.02em}.body{padding:16px 32px 30px 74px}p{margin:0 0 18px;color:#a5a7ae;font-size:13px}pre{margin:0;padding:15px 17px;overflow:auto;border:1px solid #303238;border-radius:6px;background:#0e0f11;color:#ff9b91;font:12px/1.7 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:520px){body{padding:12px}.head{padding:24px 20px 0}.body{padding:14px 20px 22px 62px}.context{font-size:9px}h1{font-size:18px}}
</style></head><body><main class="card" role="alert"><div class="windowbar"><div class="brand"><img class="logo" src="${logo}" alt="ArcMoon logo">ArcMoon</div><span class="context">DEV SERVER</span></div><header class="head"><span class="icon" aria-hidden="true">!</span><div><p class="eyebrow">COMPILER ERROR</p><h1>ArcMoon file could not be compiled</h1></div></header><section class="body"><p>Fix the error in this file or one of its dependencies, then save to reload.</p><pre>${escapeHtml(message)}</pre></section></main>${reloadScript}</body></html>`;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain", ".map": "application/json", ".wasm": "application/wasm" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ###################
// Find the closing body tag outside comments and raw-text elements. Inline JS can
// contain strings such as "</body>", which must not receive the reload snippet.
// ###################
const injectReload = (html) => {
	let i = 0;
	let raw = null;
	while (i < html.length) {
		if (raw) {
			const close = new RegExp(`<\\/\\s*${raw}\\b`, "ig");
			close.lastIndex = i;
			const match = close.exec(html);
			if (!match) break;
			const end = html.indexOf(">", match.index + match[0].length);
			if (end < 0) break;
			i = end + 1;
			raw = null;
			continue;
		}
		const start = html.indexOf("<", i);
		if (start < 0) break;
		if (html.startsWith("<!--", start)) {
			const end = html.indexOf("-->", start + 4);
			i = end < 0 ? html.length : end + 3;
			continue;
		}
		const tag = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(html.slice(start));
		if (!tag) { i = start + 1; continue; }
		let end = start + tag[0].length;
		let quote = "";
		for (; end < html.length; end++) {
			const c = html[end];
			if (quote) { if (c === quote) quote = ""; }
			else if (c === "'" || c === '"') quote = c;
			else if (c === ">") break;
		}
		if (end >= html.length) break;
		const name = tag[2].toLowerCase();
		if (tag[1] && name === "body") return `${html.slice(0, start)}${reloadScript}${html.slice(start)}`;
		if (!tag[1] && ["script", "style", "textarea", "title"].includes(name)) raw = name;
		i = end + 1;
	}
	return `${html}${reloadScript}`;
};

export function createDevServer({ root, pagesDir = root, config = {}, port = 3000, host = "127.0.0.1" }) {
	root = path.resolve(root);
	pagesDir = path.resolve(pagesDir);
	const cache = new Map();
	const clients = new Set();
	const watchers = [];
	let generation = 0;
	let workChain = Promise.resolve();
	let debounceTimer = null;
	let pending = new Set();
	let server;
	let closed = false;

	const outputDir = path.resolve(root, config.outDir ?? "./dist");
	const assetsDir = path.resolve(root, config.assetsDir ?? "assets");
	const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
	const ignored = (file) => {
		const rel = path.relative(root, file).split(path.sep);
		const base = path.basename(file);
		return rel.some((part) => part === "node_modules" || part === ".git") || inside(outputDir, file) || inside(assetsDir, file) || /^\.arcm-.*\.mjs$/.test(base) || /(?:~$|\.swp$|^\.#|^4913$)/.test(base);
	};
	const broadcast = () => { for (const client of clients) client.write("data: reload\n\n"); };

	const invalidate = async (changed = []) => {
		if (closed) return;
		generation++;
		cache.clear();
		const operation = workChain.then(async () => {
			sharedWorker().close();
			const configFile = getResolvedConfigPath();
			if (configFile && changed.some((file) => path.resolve(file) === path.resolve(configFile))) {
				try { config = await loadConfig(root); } catch (err) { reportError(err); }
			}
			broadcast();
			const names = changed.map((file) => path.relative(root, file) || path.basename(file));
			const shown = names.slice(0, 3).join(", ");
			console.log(`${dim("changed:")} ${shown}${names.length > 3 ? ` +${names.length - 3} more` : ""}`);
			if (changed.some((file) => path.basename(file) === "package-lock.json")) console.log(dim("Restart dev server to load newly installed packages."));
		});
		workChain = operation.catch(() => {});
		await operation;
	};

	const queueInvalidate = (file) => {
		if (closed) return;
		if (file && !path.isAbsolute(file)) file = path.resolve(root, file);
		if (file && ignored(file)) return;
		if (file) pending.add(file);
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(async () => {
			const changed = [...pending];
			pending = new Set();
			if (changed.length) await invalidate(changed).catch(reportError);
		}, 75);
	};

	const watch = (dir) => {
		try {
			const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
				if (closed) return;
				if (filename) queueInvalidate(path.resolve(dir, filename.toString()));
				else queueInvalidate(path.resolve(dir));
			});
			watchers.push(watcher);
			watcher.on("error", (err) => reportError(err));
		} catch (err) {
			reportError(new Error(`Cannot watch ${dir}: ${err.message}`));
		}
	};

	const safePath = (pathname) => {
		let decoded;
		try {
			decoded = pathname;
			for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded);
		} catch { return null; }
		const target = path.resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
		if (!inside(root, target) || target.split(path.sep).some((part) => part.startsWith(".") && !part.endsWith(".arcm")) || target.split(path.sep).includes("node_modules")) return null;
		return target;
	};

	const resolvePage = async (pathname) => {
		let clean = pathname.replace(/\/$/, "").replace(/\.html$/, "");
		if (!clean) clean = "/index";
		const relative = clean.replace(/^\/+/, "");
		const rootTarget = safePath(clean);
		if (!rootTarget) return { forbidden: true };
		const pageTarget = path.resolve(pagesDir, relative);
		if (!inside(pagesDir, pageTarget)) return { forbidden: true };
		const candidates = [
			pageTarget.endsWith(".arcm") ? pageTarget : `${pageTarget}.arcm`,
			path.join(pageTarget, "index.arcm"),
			rootTarget.endsWith(".arcm") ? rootTarget : `${rootTarget}.arcm`,
			path.join(rootTarget, "index.arcm")
		];
		for (const candidate of candidates) if (!ignored(candidate) && await fsp.stat(candidate).then((s) => s.isFile()).catch(() => false)) return { file: candidate };
		try {
			const all = await arcmFiles(pagesDir, { recursive: true });
			const matches = all.filter((file) => !ignored(file) && path.basename(file, ".arcm") === path.basename(pageTarget));
			if (matches.length === 1) return { file: matches[0] };
		} catch {}
		return {};
	};

	const compilePage = (file, key) => {
		if (cache.has(key)) return cache.get(key);
		const started = performance.now();
		const current = generation;
		const task = workChain.then(async () => {
			const html = injectReload(await compile(file, config, true, root));
			if (!closed) console.log(`${dim("compiled")} ${key}  ${Math.round(performance.now() - started)} ms`);
			if (current === generation && cache.get(key) === task) return html;
			return html;
		});
		cache.set(key, task);
		workChain = task.catch(() => {});
		task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
		return task;
	};

	const pageIndex = async () => {
		const files = await arcmFiles(pagesDir, { recursive: true }).catch(() => []);
		const links = files.filter((file) => !ignored(file)).map((file) => `/${path.relative(pagesDir, file).replace(/\\/g, "/").replace(/\.arcm$/, ".html")}`).sort();
		return `<!doctype html><html><body><h1>ArcMoon pages</h1><ul>${links.map((href) => `<li><a href="${href}">${href}</a></li>`).join("")}</ul>${reloadScript}</body></html>`;
	};

	const handle = async (req, res) => {
		const rawPath = (req.url ?? "/").split("?", 1)[0];
		let decodedPath = rawPath;
		try { for (let i = 0; i < 3; i++) decodedPath = decodeURIComponent(decodedPath); } catch { res.writeHead(403).end("Forbidden"); return; }
		if (decodedPath.split(/[\\/]+/).includes("..")) { res.writeHead(403).end("Forbidden"); return; }
		const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
		if (url.pathname.startsWith("/__arcmoon/")) {
			if (url.pathname !== "/__arcmoon/reload" || req.method !== "GET") { res.writeHead(404).end("Not found"); return; }
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
			res.write(": connected\n\n");
			clients.add(res);
			const ping = setInterval(() => res.write(": ping\n\n"), 25000);
			res.on("close", () => { clearInterval(ping); clients.delete(res); });
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end("Method not allowed"); return; }
		const target = safePath(url.pathname);
		if (!target) { res.writeHead(403).end("Forbidden"); return; }
		if (inside(outputDir, target)) { res.writeHead(404).end("Not found"); return; }
		if (url.pathname.endsWith(".arcm")) { res.writeHead(404).end("Not found"); return; }
		const page = await resolvePage(url.pathname);
		if (page.forbidden) { res.writeHead(403).end("Forbidden"); return; }
		if (page.file) {
			try {
				const html = await compilePage(page.file, url.pathname);
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
				res.end(req.method === "HEAD" ? undefined : html);
			} catch (err) {
				reportError(err);
				res.writeHead(500, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
				res.end(errorPage(err?.message ?? err));
			}
			return;
		}
		if (url.pathname === "/" && !(await fsp.stat(path.join(root, "index.arcm")).then((s) => s.isFile()).catch(() => false))) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
			res.end(await pageIndex());
			return;
		}
		const basename = path.basename(target);
		if (target.endsWith(".arcm") || basename.startsWith(".") || ["package.json", "package-lock.json", CONFIG_FILE].includes(basename) || !types[path.extname(target).toLowerCase()]) {
			res.writeHead(404).end("Not found");
			return;
		}
		try {
			const stat = await fsp.stat(target);
			if (!stat.isFile()) throw new Error("not a file");
			const body = await fsp.readFile(target);
			res.writeHead(200, { "Content-Type": `${types[path.extname(target)] ?? "application/octet-stream"}${types[path.extname(target)]?.startsWith("text/") || [".js", ".mjs", ".svg", ".json"].includes(path.extname(target)) ? "; charset=utf-8" : ""}`, "Cache-Control": "no-store" });
			res.end(req.method === "HEAD" ? undefined : body);
		} catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found"); }
	};

	return {
		async listen() {
			server = http.createServer((req, res) => { handle(req, res).catch((err) => { reportError(err); if (!res.headersSent) res.writeHead(500); res.end("Internal server error"); }); });
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => { server.off("error", reject); resolve(); });
			});
			watch(root);
			if (!inside(root, pagesDir) && !inside(pagesDir, root)) watch(pagesDir);
			for (const dir of config.watch ?? []) watch(path.resolve(root, dir));
			return server.address();
		},
		async close() {
			if (closed) return;
			closed = true;
			clearTimeout(debounceTimer);
			for (const watcher of watchers) watcher.close();
			for (const client of clients) client.end();
			clients.clear();
			await workChain;
			sharedWorker().close();
			if (server?.listening) await new Promise((resolve) => server.close(resolve));
		},
		invalidate: () => invalidate([])
	};
}
