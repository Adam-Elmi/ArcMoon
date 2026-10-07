// ###################
// JS bundling tests: [script] files, build(), buildPages() with shared chunks
// ###################

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";
import { JSDOM } from "jsdom";
import { SourceMapConsumer } from "source-map-js";
import ArcMoon, { buildPages } from "../node/compiler.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
// ###################
// Paths with "/" on every system, so one regex fits Windows too
// ###################
const slashed = (p) => p.split(sep).join("/");
const am = (src) => new ArcMoon({ src, cwd: FIXTURES });
const open = (html) => new JSDOM(html.replace(`<script type="module">`, "<script>"), { runScripts: "dangerously" }).window;

describe("[script = src] files", () => {
	it("bundles a local script and its imports into the inline script", async () => {
		const html = await am(`[p]a[end][script = src: "./scripts/app.js" !]`).compile();
		expect(html).not.toContain(`src="./scripts/app.js"`);
		expect(open(html).__app).toBe("hello app");
	});

	it("leaves external scripts alone", async () => {
		const html = await am(`[script = src: "https://cdn.example.com/x.js" !]`).compile();
		expect(html).toBe(`<script src="https://cdn.example.com/x.js"></script>`);
	});

	it("runs script files before runtime blocks", async () => {
		const html = await am(`runtime \${ window.__seen = window.__app; }\$\n[script = src: "./scripts/app.js" !]`).compile();
		expect(open(html).__seen).toBe("hello app");
	});

	it.each([
		[`[p]a[end]\n  [script = src: "./scripts/nope.js" !]`, /anonymous\.arcm:2:3 {2}can't find script "\.\/scripts\/nope\.js"/],
		[`[script = src: "./scripts/npm.js" !]`, /scripts[\\/]npm\.js:1:22 {2}runtime import "canvas-confetti" is not listed in bundle/]
	])("reports %s", async (src, message) => {
		await expect(am(src).compile()).rejects.toThrow(message);
	});
});

describe("build() and buildPages()", () => {
	it("build() returns the HTML with a script src and the JS files", async () => {
		const { html, files } = await new ArcMoon({ src: `runtime \${ window.__n = 1; }\$\n[p]a[end]`, cwd: FIXTURES, name: "home" }).build({ outDir: "out" });
		expect(html).toMatch(/^<p>a<\/p><script type="module" src="\.\/assets\/home-[A-Z0-9]+\.js"><\/script>$/);
		expect(files.map((f) => slashed(relative(FIXTURES, f.path)))).toEqual([expect.stringMatching(/^out\/assets\/home-[A-Z0-9]+\.js$/)]);
	});

	it("puts code shared by pages into a chunk, and skips pages without JS", async () => {
		const page = (n) => ({ src: `runtime \${ import { signal } from "arcmoon/reactive"; const s = signal(${n}); }\$\n[p]runtime \${ s() }\$[end][script = src: "./scripts/app.js" !]`, name: `p${n}` });
		const { pages, files } = await buildPages([page(1), page(2), { src: "[p]plain[end]", name: "plain" }], { cwd: FIXTURES, outDir: "out" });
		const names = files.map((f) => slashed(relative(FIXTURES, f.path)));
		expect(names.filter((n) => n.includes("/chunks/"))).toHaveLength(1);
		expect(names.filter((n) => /out\/assets\/p[12]-/.test(n))).toHaveLength(2);
		const [p1, p2, plain] = pages;
		expect(p1.html).toMatch(/src="\.\/assets\/p1-[A-Z0-9]+\.js"/);
		expect(p2.html).toMatch(/src="\.\/assets\/p2-[A-Z0-9]+\.js"/);
		expect(plain.html).toBe("<p>plain</p>");
		const chunk = files.find((f) => slashed(f.path).includes("/chunks/")).contents;
		expect(chunk).toContain("hello");
		expect(files.find((f) => /p1-/.test(f.path)).contents.length).toBeLessThan(chunk.length);
	});

	it("uses base for script URLs when given", async () => {
		const { html } = await new ArcMoon({ src: `runtime \${ window.__n = 1; }\$`, cwd: FIXTURES, name: "x" }).build({ outDir: "out", base: "/static" });
		expect(html).toMatch(/src="\/static\/assets\/x-[A-Z0-9]+\.js"/);
	});
});

describe("dev builds", () => {
	const src = `[h1]Hi[end]\nruntime \${\n  const counter = 1;\n  function explode() {\n    return counter.missing.value;\n  }\n}\$\n[p]runtime \${ counter + explode() }\$[end]`;
	// ###################
	// Where a piece of the output JS comes from, by its inline source map
	// ###################
	const origin = (js, word) => {
		const map = JSON.parse(Buffer.from(/base64,(\S+)/.exec(js)[1], "base64").toString());
		const lines = js.split("\n");
		const line = lines.findLastIndex((l) => l.includes(word));
		const { source, line: at, column } = new SourceMapConsumer(map).originalPositionFor({ line: line + 1, column: lines[line].indexOf(word) });
		return `${source}:${at}:${column + 1}`;
	};

	it("keeps names and maps the JS back to .arcm lines", async () => {
		const html = await am(src).compile();
		expect(html).not.toContain("sourceMappingURL");
		expect(html).not.toContain("explode");

		const dev = await new ArcMoon({ src, cwd: FIXTURES, dev: true }).compile();
		const js = /<script type="module">([\s\S]*)<\/script>/.exec(dev)[1];
		expect(js).toContain("function explode()");
		expect(origin(js, "counter.missing")).toBe("anonymous.arcm:5:12");
		expect(origin(js, "explode()")).toBe("anonymous.arcm:8:25");
	});

	it("maps separate JS files too", async () => {
		const { files } = await buildPages([{ src, name: "x", filename: `${FIXTURES}/pages/x.arcm` }], { cwd: FIXTURES, outDir: "out", dev: true });
		expect(origin(files[0].contents, "counter.missing")).toBe("pages/x.arcm:5:12");
	});
});
