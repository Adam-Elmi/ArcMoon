// ###################
// On-demand dev server, cache invalidation, errors, paths, and live reload
// ###################

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../cli/helpers/devserver.js";
import { parseDevArgs, resolveHost, networkUrls } from "../cli/commands/dev.js";

let root;
let server;
let base;

const get = (url) => fetch(`${base}${url}`);
const rawStatus = (pathname) => new Promise((resolve, reject) => {
	const address = new URL(base);
	http.get({ hostname: address.hostname, port: address.port, path: pathname }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", reject);
});
const freePort = () => new Promise((resolve, reject) => {
	const probe = net.createServer();
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", () => {
		const { port } = probe.address();
		probe.close((err) => err ? reject(err) : resolve(port));
	});
});
const CLI = fileURLToPath(new URL("../cli/cli.mjs", import.meta.url));
const buildTime = (code) => "${ " + code + " }$";
const stripAnsi = (text) => text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "arcmoon-dev-"));
	await mkdir(join(root, "pages"), { recursive: true });
	server = createDevServer({ root, port: 0, host: "127.0.0.1" });
	const address = await server.listen();
	base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
	await server?.close();
	await rm(root, { recursive: true, force: true });
});

describe("dev server", () => {
	it("parses dir/key-value arguments in any order and validates the port", () => {
		const first = parseDevArgs(["docs", "port=4000", "host=true"], root);
		const second = parseDevArgs(["port=4000", "docs", "host=true"], root);
		expect(first).toEqual(second);
		expect(first).toEqual({ root, pagesDir: join(root, "docs"), port: 4000, host: true });
		expect(parseDevArgs(["pages", "--port=4001", "--host", "127.0.0.1"], root)).toEqual({ root, pagesDir: join(root, "pages"), port: 4001, host: "127.0.0.1" });
		expect(resolveHost(true)).toBe("0.0.0.0");
		expect(resolveHost(false)).toBe("127.0.0.1");
		expect(resolveHost()).toBe("127.0.0.1");
		expect(resolveHost("192.168.1.5")).toBe("192.168.1.5");
		expect(() => parseDevArgs(["port=abc"], root)).toThrow("between 1 and 65535");
		expect(() => parseDevArgs(["port=99999"], root)).toThrow("between 1 and 65535");
		expect(() => parseDevArgs(["port=0"], root)).toThrow("between 1 and 65535");
	});

	it("lists external IPv4 addresses with private ranges first", () => {
		const interfaces = {
			public: [{ family: "IPv4", address: "8.8.8.8", internal: false }],
			loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
			wifi: [{ family: "IPv4", address: "192.168.1.20", internal: false }, { family: "IPv4", address: "10.0.0.2", internal: false }],
			ipv6: [{ family: "IPv6", address: "fe80::1", internal: false }]
		};
		expect(networkUrls(interfaces, 4000)).toEqual(["http://192.168.1.20:4000", "http://10.0.0.2:4000", "http://8.8.8.8:4000"]);
	});

	it("serves and caches a page compiled on request", async () => {
		await writeFile(join(root, "index.arcm"), `[h1]Hello[end]`);
		await new Promise((resolve) => setTimeout(resolve, 120));
		const first = await get("/");
		const html = await first.text();
		expect(first.status).toBe(200);
		expect(html).toContain("<h1>Hello</h1>");
		expect(html).toContain("EventSource(\"/__arcmoon/reload\")");
		expect(first.headers.get("cache-control")).toBe("no-store");
		const logs = [];
		const old = console.log;
		console.log = (...args) => logs.push(args.join(" "));
		try { await (await get("/")).text(); } finally { console.log = old; }
		expect(logs).toEqual([]);
	});

	it("inserts reload after the real body, not inside script text", async () => {
		await writeFile(join(root, "index.arcm"), `runtime \${ const body = "</body>"; window.__body = body; }\$[p]Page[end]`);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const html = await (await get("/")).text();
		const scriptEnd = html.indexOf("</script>");
		const reloadAt = html.indexOf('EventSource("/__arcmoon/reload")');
		expect(html).toContain('const body = "</body>"');
		expect(reloadAt).toBeGreaterThan(scriptEnd);
	});

	it("returns an index of pages when root index.arcm is absent", async () => {
		await writeFile(join(root, "pages/about.arcm"), `[p]About[end]`);
		const response = await get("/");
		expect(await response.text()).toContain("/pages/about.html");
	});

	it("refreshes JSON and nested JavaScript imports after invalidation", async () => {
		await writeFile(join(root, "users.json"), JSON.stringify({ value: "before" }));
		await writeFile(join(root, "b.js"), `export const value = "nested-before";`);
		await writeFile(join(root, "a.js"), `export { value } from "./b.js";`);
		await writeFile(join(root, "index.arcm"), `${buildTime('import users from "./users.json" with { type: "json" }; import { value } from "./a.js";')}[p]${buildTime("users.value + ' ' + value")}[end]`);
		expect(await (await get("/")).text()).toContain("before nested-before");
		await writeFile(join(root, "users.json"), JSON.stringify({ value: "after" }));
		await writeFile(join(root, "b.js"), `export const value = "nested-after";`);
		await server.invalidate();
		const html = await (await get("/")).text();
		expect(html).toContain("after nested-after");
	});

	it("does not crash on compile errors and reloads after a fix", async () => {
		await writeFile(join(root, "index.arcm"), buildTime('throw new Error("bad <page>");'));
		const error = await get("/");
		const errorHtml = await error.text();
		expect(error.status).toBe(500);
		expect(errorHtml).toContain("class=\"card\"");
		expect(errorHtml).toContain("ArcMoon file could not be compiled");
		expect(errorHtml).toContain('alt="ArcMoon logo"');
		expect(errorHtml).toContain("data:image/svg+xml;base64,");
		expect(errorHtml).not.toContain("Waiting for your next change");
		expect(errorHtml).not.toContain("class=\"dot\"");
		expect(errorHtml).toContain("bad &lt;page&gt;");
		expect(errorHtml).toContain("/__arcmoon/reload");
		await writeFile(join(root, "index.arcm"), `[p]fixed[end]`);
		await server.invalidate();
		const fixed = await get("/");
		expect(fixed.status).toBe(200);
		expect(await fixed.text()).toContain("<p>fixed</p>");
	});

	it("rejects traversal and never serves raw ArcMoon or dotfiles", async () => {
		for (const url of ["/%2e%2e/etc/passwd", "/%252e%252e/etc/passwd"]) expect(await rawStatus(url)).toBe(403);
		await writeFile(join(root, "secret.arcm"), "private source");
		await writeFile(join(root, ".hidden"), "private file");
		expect((await get("/secret.arcm")).status).toBe(404);
		expect((await get("/.hidden")).status).toBe(403);
	});

	it("serves static assets and refuses configured output files", async () => {
		await writeFile(join(root, "app.css"), "body { color: red }\n");
		await mkdir(join(root, "dist"), { recursive: true });
		await writeFile(join(root, "dist/built.html"), "not served");
		await writeFile(join(root, "package.json"), "{}");
		await writeFile(join(root, "package-lock.json"), "{}");
		await writeFile(join(root, "arcmoon.config.js"), "export default {};");
		await writeFile(join(root, "notes.md"), "private docs");
		const css = await get("/app.css");
		expect(css.headers.get("content-type")).toContain("text/css");
		expect(await css.text()).toContain("color: red");
		expect((await get("/dist/built.html")).status).toBe(404);
		for (const path of ["/package.json", "/package-lock.json", "/arcmoon.config.js", "/notes.md"]) expect((await get(path)).status).toBe(404);
	});

	const lanUrls = networkUrls(networkInterfaces(), 1);
	it.skipIf(!lanUrls.length)("serves a page through a non-loopback address when bound to all interfaces", async () => {
		await writeFile(join(root, "index.arcm"), `[p]LAN access[end]`);
		const dev = createDevServer({ root, host: resolveHost(true), port: 0 });
		try {
			const address = await dev.listen();
			await new Promise((resolve) => setTimeout(resolve, 100));
			const endpoint = new URL(networkUrls(networkInterfaces(), address.port)[0]);
			const response = await fetch(endpoint);
			expect(response.status).toBe(200);
			expect(await response.text()).toContain("<p>LAN access</p>");
		} finally { await dev.close(); }
	});

	it("shares concurrent requests for the same uncached page", async () => {
		await writeFile(join(root, "index.arcm"), `[p]single compile[end]`);
		await new Promise((resolve) => setTimeout(resolve, 100));
		let compiled = 0;
		const old = console.log;
		console.log = (...args) => { if (stripAnsi(args.join(" ")).includes("compiled /")) compiled++; };
		try {
			const responses = await Promise.all([get("/"), get("/")]);
			await Promise.all(responses.map((response) => response.text()));
		} finally { console.log = old; }
		expect(compiled).toBe(1);
	});

	it("does not cache an old-generation compile after invalidation", async () => {
		await writeFile(join(root, "index.arcm"), `${buildTime("await new Promise((resolve) => setTimeout(resolve, 150));")}[p]old[end]`);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const oldRequest = get("/").then((response) => response.text());
		await new Promise((resolve) => setTimeout(resolve, 30));
		await writeFile(join(root, "index.arcm"), `[p]new[end]`);
		const invalidated = server.invalidate();
		expect(await oldRequest).toContain("<p>old</p>");
		await invalidated;
		expect(await (await get("/")).text()).toContain("<p>new</p>");
	});

	it("notifies SSE clients after invalidation", async () => {
		const controller = new AbortController();
		const response = await fetch(`${base}/__arcmoon/reload`, { signal: controller.signal });
		const reader = response.body.getReader();
		await reader.read();
		await server.invalidate();
		const message = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ value: new TextEncoder().encode("timeout") }), 500))]);
		expect(new TextDecoder().decode(message.value)).toContain("data: reload");
		controller.abort();
	});

	it("coalesces rapid filesystem changes into one invalidation", async () => {
		let messages = 0;
		const old = console.log;
		console.log = (...args) => { if (args.join(" ").includes("changed:")) messages++; };
		try {
			for (let i = 0; i < 10; i++) await writeFile(join(root, `change-${i}.txt`), String(i));
			await new Promise((resolve) => setTimeout(resolve, 200));
		} finally { console.log = old; }
		expect(messages).toBe(1);
	});

	it("ignores output and node_modules changes", async () => {
		await mkdir(join(root, "dist"), { recursive: true });
		await mkdir(join(root, "node_modules/pkg"), { recursive: true });
		await new Promise((resolve) => setTimeout(resolve, 100));
		let messages = 0;
		const old = console.log;
		console.log = (...args) => { if (args.join(" ").includes("changed:")) messages++; };
		try {
			await writeFile(join(root, "dist/out.html"), "out");
			await writeFile(join(root, "node_modules/pkg/index.js"), "pkg");
			await new Promise((resolve) => setTimeout(resolve, 150));
		} finally { console.log = old; }
		expect(messages).toBe(0);
	});

	it("starts through the CLI and shuts down cleanly on SIGTERM", async () => {
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "arcmoon.config.js"), `export default { importAliases: { "@": "./src" } };`);
		await writeFile(join(root, "src/Header.arcm"), `[h1]Configured alias[end]`);
		await writeFile(join(root, "pages/index.arcm"), `[import = Header: "@/Header.arcm" !][Header!]`);
		const port = await freePort();
		const child = spawn(process.execPath, [CLI, "dev", "pages", "--host", "127.0.0.1", `--port=${port}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout.setEncoding("utf8").on("data", (data) => { output += data; });
		child.stderr.setEncoding("utf8").on("data", (data) => { output += data; });
		try {
			const url = await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`CLI did not start: ${output}`)), 4000);
				child.on("exit", (code) => reject(new Error(`CLI exited with ${code}: ${output}`)));
				const inspect = setInterval(() => {
				const match = new RegExp(`Local:\\s+http:\\/\\/localhost:${port}`).exec(output);
				if (match) { clearTimeout(timer); clearInterval(inspect); resolve(`http://127.0.0.1:${port}`); }
				}, 10);
			});
			const response = await fetch(`${url}/`);
			expect(response.status).toBe(200);
			expect(await response.text()).toContain("<h1>Configured alias</h1>");
		} finally {
			child.kill("SIGTERM");
			await new Promise((resolve) => child.once("exit", resolve));
		}
	});
});
