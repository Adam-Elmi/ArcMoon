// ###################
// CSS tests: [style] body, scoped component styles, -- props
// ###################

import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import lexer from "../core/lexer.js";
import ArcMoon from "../node/compiler.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/styles", import.meta.url));

const compile = (src, options = {}) => new ArcMoon({ src, cwd: FIXTURES, ...options }).compile();
const flat = (html) => html.replace(/\s*\n\s*/g, "");
const types = (src) => lexer(src).filter((t) => t.type !== "WHITESPACE" && t.type !== "EOF").map((t) => `${t.type}:${t.value}`);

describe("[style] body", () => {
	it("reads only text, escapes and logic", () => {
		expect(types(`[style]#a[type="x"] { c: "\\2014"; } \${ v }\$[end:style]`)).toEqual([
			"OPEN_BRACKET:[", "IDENTIFIER:style", "CLOSE_BRACKET:]",
			`TEXT:#a[type="x"] { c: "\\2014"; } `,
			"LOGIC_OPEN:${", "LOGIC: v ", "LOGIC_CLOSE:}$",
			"OPEN_BRACKET:[", "END_KEYWORD:end:style", "CLOSE_BRACKET:]"
		]);
	});

	it("writes CSS as it is, with \\[end and \\${ as literals", async () => {
		const html = await compile(`[style]#main { color: #333; } .sm\\:hidden { content: "\\[end \\\${"; }[end]`);
		expect(html).toBe(`<style>#main{color:#333}.sm\\:hidden{content:"[end \${"}</style>`);
	});

	it("puts values in and escapes </style", async () => {
		const html = await compile(`\${ const c = "red"; }\$\n[style]p { color: \${ c }\$; content: "\${ "</style>" }\$"; }[end:style]`);
		expect(html).toBe(`<style>p{color:red;content:"<\\/style>"}</style>`);
	});

	it("keeps arcm-raw [style] as written, and drops an empty [style!]", async () => {
		expect(await compile(`[style = arcm-raw: true]a \${ x }\$[end]`)).toBe(`<style>a \${ x }\$</style>`);
		expect(await compile(`[style!][p]x[end]`)).toBe(`<p>x</p>`);
	});
});

describe("scoped component styles", () => {
	it("scopes a component's elements and moves its CSS into <head> once", async () => {
		const html = await compile(
			`[import = Box: "./Box.arcm" !]\n[html][head][title]t[end][end][body][Box][h2]mine[end][end][Box!][h2]page[end][end][end]`
		);
		const attr = /<div class="box" (data-a-[a-z0-9]+)>/.exec(html)[1];
		expect(html.match(/<style>/g)).toHaveLength(1);
		expect(flat(html)).toContain(
			`<head><title>t</title><style>.box[${attr}]{padding:1rem}h2[${attr}],p[${attr}]:before{color:tomato}.dark h2[${attr}]{color:#fff}@media(max-width:600px){.box[${attr}]{padding:0}}@keyframes spin-${attr.slice(7)}{0%{opacity:0}}</style></head>`
		);
		// Slot content keeps the caller's scope; a child component's insides are not affected
		expect(flat(html)).toContain(`<div class="box" ${attr}><h2 ${attr}>Box</h2><h2>mine</h2><span class="inner">in</span></div>`);
		expect(html).toContain(`<h2>page</h2>`);
	});

	it("bundles a [link] written in a styled component, and removes lines left empty", async () => {
		const html = await compile(`[import = Shell: "./Shell.arcm" !]\n[Shell!]\n[p]x[end]\n[style]\n  p { color: red }\n[end]\n[p]y[end]`);
		expect(html).toMatch(/^<head data-a-[a-z0-9]+><style>body\{color:navy\}p\{color:red\}head\[data-a-[a-z0-9]+\]\{display:none\}<\/style><\/head>\n<p>x<\/p>\n<p>y<\/p>$/);
	});

	it("puts the <style> at the start when there is no <head>", async () => {
		const html = await compile(`[import = Box: "./Box.arcm" !]\n[doctype!]\n[Box!]`);
		expect(html).toMatch(/^<!doctype html><style>\.box\[data-a-/);
	});

	it("keeps page styles global", async () => {
		expect(await compile(`[style]h2 { color: red; }[end][h2]x[end]`)).toBe(`<style>h2{color:red}</style><h2>x</h2>`);
	});

	it("rejects runtime ${ }$ in a component's [style]", async () => {
		await expect(compile(`[import = Live: "./Live.arcm" !][Live!]`)).rejects.toThrow(/Live\.arcm:3:14 {2}runtime \$\{ \}\$ is not allowed in a component's \[style\]/);
	});

	it("points CSS errors at the line inside [style]", async () => {
		await expect(compile(`[import = B: "./BadCss.arcm" !][B!]`)).rejects.toThrow(/BadCss\.arcm:3:1 {2}CSS error in \[style\]: Unknown word/);
		await expect(compile(`[p]x[end]\n[style]\n@import "./nope.css";\n[end]`)).rejects.toThrow(/anonymous\.arcm:3:9 {2}Could not resolve "\.\/nope\.css"/);
	});

	it("passes esbuild's CSS warnings on, at the line inside [style]", async () => {
		const onWarning = vi.fn();
		await compile(`[p]x[end]\n[style]\np {\n  color: red;\n  }}\n[end]`, { onWarning });
		expect(onWarning).toHaveBeenCalledWith({ source: expect.stringMatching(/anonymous\.arcm$/), position: { line: 4, character: 3 }, message: `Unexpected "}"` });
	});

	it("warns when uses give different CSS, and keeps the first", async () => {
		const onWarning = vi.fn();
		const html = await compile(`[import = D: "./Differs.arcm" !][D = color: "red" !][D = color: "blue" !]`, { onWarning });
		expect(html).toContain("color:red");
		expect(html).not.toContain("color:#00f");
		expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("different CSS for different uses") }));
	});
});

describe("-- props", () => {
	it("set CSS variables and join style:", async () => {
		const html = await compile(`\${ const brand = "#e33"; }\$\n[div = style: "color: red;", --gap: "8px", --brand: \${ brand }\$, --off: false][end]`);
		expect(html).toBe(`<div style="color: red; --gap: 8px; --brand: #e33"></div>`);
	});

	it("start live values from the signal", async () => {
		const html = await compile(`runtime \${ import { signal } from "arcmoon/reactive"; const p = signal("30%"); }\$\n[div = --p: runtime \${ p() }\$][end]`);
		expect(html).toMatch(/<div data-arcm-ref="e0" style="--p: 30%"><\/div>/);
	});
});

describe("scoped @keyframes", () => {
	it("gives each component its own keyframes; page and -global- keyframes stay global", async () => {
		const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = await mkdtemp(join(tmpdir(), "arcmoon-keyframes-"));
		try {
			await writeFile(join(dir, "A.arcm"), `[div]a[end]\n[style]\n  @keyframes spin { to { rotate: 360deg } }\n  @keyframes -global-fade { to { opacity: 0 } }\n  div { animation: spin 1s linear infinite, pulse 2s; }\n[end]`);
			await writeFile(join(dir, "B.arcm"), `[p]b[end]\n[style]\n  @keyframes spin { to { opacity: 0 } }\n  p { animation-name: spin; }\n[end]`);
			const html = await new ArcMoon({ src: `[import = A: "./A.arcm" !][import = B: "./B.arcm" !]\n[A!][B!]\n[style]\n  @keyframes pulse { to { scale: 1.1 } }\n[end]`, cwd: dir }).compile();
			const a = /<div (data-a-[a-z0-9]+)>/.exec(html)[1].slice(7);
			const b = /<p (data-a-[a-z0-9]+)>/.exec(html)[1].slice(7);
			expect(a).not.toBe(b);
			expect(html).toContain(`@keyframes spin-${a}{to{rotate:360deg}}`);
			expect(html).toContain(`@keyframes spin-${b}{to{opacity:0}}`);
			expect(html).toContain(`animation:spin-${a} 1s linear infinite,pulse 2s`);
			expect(html).toContain(`animation-name:spin-${b}`);
			expect(html).toContain("@keyframes pulse{");
			expect(html).toContain("@keyframes fade{");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("-- prop values are checked", () => {
	it("refuses ; { } that would add other CSS", async () => {
		await expect(compile(`\${ const input = "1px; background: url(https://evil.example/t)"; }\$\n[div = --size: \${ input }\$][end]`)).rejects.toThrow(
			/anonymous\.arcm:2:1 {2}--size on \[div\] can't contain ";", "\{" or "\}": it would add other CSS to the element/
		);
		await expect(compile(`[p = --x: "a { b }"]x[end]`)).rejects.toThrow(/--x on \[p\] can't contain/);
	});

	it("accepts normal values: calc, quotes, url", async () => {
		expect(await compile(`[div = --size: "calc(1px + 2px)", --font: "\\"Inter\\", sans-serif", --img: "url(a.png)"][end]`)).toBe(
			`<div style="--size: calc(1px + 2px); --font: &quot;Inter&quot;, sans-serif; --img: url(a.png)"></div>`
		);
	});
});

describe("css. props", () => {
	const warnings = async (src) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const html = await compile(src);
			return { html, warnings: warn.mock.calls.map((c) => c[0].replace(/^.*anonymous\.arcm:/, "")) };
		} finally {
			warn.mockRestore();
		}
	};

	it("sets CSS properties in style, with fixed and compile-time values", async () => {
		expect(await compile(`\${ const bg = "black"; }\$[p = css.color: "white", css.background: \${ bg }\$, css.opacity: 0.5]Hi[end]`)).toBe(
			`<p style="color: white; background: black; opacity: 0.5">Hi</p>`
		);
	});

	it("joins style:, css. and -- props in the order written", async () => {
		expect(await compile(`[div = css.color: "red", style: "margin: 0;", --x: "1" !]`)).toBe(`<div style="color: red; margin: 0; --x: 1"></div>`);
	});

	it("keeps the attribute and the CSS apart", async () => {
		expect(await compile(`[img = width: 100, css.width: "50%" !]`)).toBe(`<img width="100" style="width: 50%">`);
	});

	it("leaves out false and passes css. to a component's outer element", async () => {
		const html = await compile(`[import = Card: "./components/Card.arcm" !][Card = title: "T", css.border: "1px solid", css.color: false !]`, { cwd: fileURLToPath(new URL("./fixtures", import.meta.url)) });
		expect(html).toContain(`<div class="card card-gray" style="border: 1px solid">`);
	});

	it("writes nothing for an empty value", async () => {
		expect(await compile(`[p = css.align-self: "", css.color: "  ", css.width: "50%"]x[end]`)).toBe(`<p style="width: 50%">x</p>`);
		expect(await compile(`[p = css.color: ""]x[end]`)).toBe(`<p>x</p>`);
	});

	it("gives only the error, not the typo warning, for a name that can't be a property", async () => {
		const { warnings: w } = await warnings(`[p = css.colr: "red" !]`);
		expect(w).toHaveLength(1);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(compile(`[p = css.1x: "red"]x[end]`)).rejects.toThrow(/css\.1x on \[p\] is not a valid CSS property name/);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("refuses ; { } and bad names", async () => {
		await expect(compile(`[p = css.color: "red; background: url(x)"]x[end]`)).rejects.toThrow(/css\.color on \[p\] can't contain ";", "\{" or "\}"/);
		await expect(compile(`[p = css.: "red"]x[end]`)).rejects.toThrow(/css\. on \[p\] is not a valid CSS property name/);
		await expect(compile(`[p = css.1x: "red"]x[end]`)).rejects.toThrow(/css\.1x on \[p\] is not a valid CSS property name/);
	});

	it("warns about names that are not CSS properties, and still writes them", async () => {
		const { html, warnings: w } = await warnings(`[p = css.colr: "red", css.-webkit-line-clamp: 2, css.--y: "3", css.font-size: "2rem" !]`);
		expect(w).toEqual(["1:1  css.colr on [p] is not a CSS property (did you mean css.color?)"]);
		expect(html).toBe(`<p style="colr: red; -webkit-line-clamp: 2; --y: 3; font-size: 2rem"></p>`);
	});
});

describe("page [style] that reaches into components", () => {
	const warnings = async (src) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const html = await compile(src);
			return { html, warnings: warn.mock.calls.map((c) => c[0].replace(/^.*anonymous\.arcm:/, "")) };
		} finally {
			warn.mockRestore();
		}
	};
	const page = (css, body = `[div = class: "bar"]x[end]`) => `[import = Bar: "./Bar.arcm" !]\n[Bar]${body}[end]\n[style]\n  ${css}\n[end]`;

	it("warns when a page class also styles a component's elements", async () => {
		const { warnings: w } = await warnings(page(`.bar:hover { color: red; }`));
		expect(w).toEqual([
			`4:3  ".bar:hover" in the page's [style] also styles elements in Bar.arcm. Page styles are global: use a class only this page uses, or write :global(.bar:hover) if that's on purpose`
		]);
	});

	it("stays quiet for element names, page-only classes and classes only components use", async () => {
		expect((await warnings(page(`h1, div { margin: 0; }`))).warnings).toEqual([]);
		expect((await warnings(page(`.mine { color: red; }`, `[p = class: "mine"]x[end]`))).warnings).toEqual([]);
		expect((await warnings(page(`.bar { color: red; }`, `[p]x[end]`))).warnings).toEqual([]);
	});

	it("takes :global() as on purpose and writes plain CSS", async () => {
		const { html, warnings: w } = await warnings(page(`:global(.bar) h1, .x :global(.bar) { color: red; }`));
		expect(w).toEqual([]);
		expect(html).toContain(`<style>.bar h1,.x .bar{color:red}</style>`);
	});
});
