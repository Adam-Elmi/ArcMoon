// ###################
// JS bundling tests: [script] files, build(), buildPages() with shared chunks
// ###################

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";
import { JSDOM } from "jsdom";
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
