// ###################
// arcmoon-highlight tests: tokens, staticHighlight and its config, errors, the live editor
// ###################

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { staticHighlight, defaultTokens, tokenize, highlightJs } from "../index.js";
import { attachHighlighter } from "../src/dynamic.js";
import { diagnose } from "../src/diagnostics.js";

const PAGE = `# a page\n[import = Card: "./Card.arcm" !]\n\${ const n = 1; }\$\n[p = class: "a", n: 2, ok: true]Hi \\[x \${ n }\$[end:p]\nruntime \${ let a = n; }\$\n### many\nlines ###`;
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const span = (style, text) => `<span style="${style}">${text}</span>`;

describe("tokens", () => {
	it("keep the text as written: quotes, # and \\ included", () => {
		const values = tokenize(`[p = a: "x"]\\[ # no\n# c[end]`).map((t) => `${t.type}:${t.value}`);
		expect(values).toContain(`STRING:"x"`);
		expect(values).toContain(`ESCAPE:\\[`);
		expect(values).toContain(`COMMENT:# c[end]`);
	});

	it("never throw: half-written code is highlighted up to the error", () => {
		const tokens = tokenize(`[p = a: "x]Hi`);
		expect(tokens.map((t) => t.value).join("")).toBe(`[p = a: "x]Hi`);
		expect(tokens.at(-1)).toMatchObject({ type: "TEXT", value: `"x]Hi` });
		expect(tokenize("${ open").map((t) => t.value).join("")).toBe("${ open");
	});
});

describe("staticHighlight", () => {
	it("gives back the same text, with every kind of token", () => {
		expect(plain(staticHighlight(PAGE))).toBe(PAGE);
		for (const broken of [`[p = a: "x]`, "${ a", "[p", "### open"]) expect(plain(staticHighlight(broken))).toBe(broken);
	});

	it("uses the default colors", () => {
		const html = staticHighlight(PAGE);
		expect(html).toContain(span("color:#4ec9b0", "p"));
		expect(html).toContain(span("color:#7dd3fc", "class"));
		expect(html).toContain(span("color:#ce9178", `"a"`));
		expect(html).toContain(span("color:#b5cea8", "2"));
		expect(html).toContain(span("color:#569cd6", "true"));
		expect(html).toContain(span("color:#c586c0;font-weight:bold", "end:p"));
		expect(html).toContain(span("color:#6a9955;font-style:italic", "# a page"));
		expect(html).toContain(span("color:#fb923c", "\\["));
		expect(html).toContain(span("color:#c586c0", "runtime"));
		expect(html).toContain(span("color:#c586c0", "const"));
	});

	it("escapes HTML in text, strings and code", () => {
		const html = staticHighlight(`[p = t: "<b>"]a < b & c[end]\${ 1 < 2 }\$`);
		expect(html).not.toMatch(/<b>|a < b/);
		expect(html).toContain("&lt;b&gt;");
		expect(html).toContain("&amp;");
	});

	it("follows onToken → tokens[type] → other → defaults", () => {
		const src = `[p = a: "x"]Hi[end]`;
		const html = staticHighlight(src, {
			onToken: ({ current }) => (current.type === "TEXT" ? "<i>Hi</i>" : undefined),
			tokens: {
				IDENTIFIER: "red",
				KEY: { color: "blue", bold: true, italic: true },
				STRING: { render: (v, type) => `<u>${type}${v}</u>` },
				END_KEYWORD: { context: ({ prev, next }) => `<s>${prev.value}${next.value}</s>` },
				EQUAL: null,
				COLON: { context: () => undefined }
			},
			other: "gray"
		});
		expect(html).toBe(
			`<span style="color:gray">[</span><span style="color:red">p</span> = <span style="color:blue;font-weight:bold;font-style:italic">a</span><span style="color:gray">:</span> <u>STRING"x"</u><span style="color:gray">]</span><i>Hi</i><span style="color:gray">[</span><s>[]</s><span style="color:gray">]</span>`
		);
	});

	it("can extend the defaults", () => {
		const html = staticHighlight("[p!]", { tokens: { ...defaultTokens, IDENTIFIER: "pink" } });
		expect(html).toContain(span("color:pink", "p"));
		expect(html).toContain(span("color:#f87171", "!"));
	});

	it("gives class names with classPrefix, for themes in CSS", () => {
		const html = staticHighlight(`[p = n: 1]\${ go(x) }\$[end]`, { classPrefix: "arcm-" });
		expect(html).toContain(`<span class="arcm-identifier">p</span>`);
		expect(html).toContain(`<span class="arcm-end-keyword">end</span>`);
		expect(html).toContain(`<span class="arcm-logic"> <span class="arcm-js-call">go</span>`);
		expect(html).not.toContain("style=");
	});
});

describe("staticHighlight errors", () => {
	const src = "${ cosnt a = 1; }$\n[p]x[end][end]";

	it("are off by default", () => {
		expect(staticHighlight(src)).not.toContain("wavy");
		expect(staticHighlight(src, { errors: [] })).toBe(staticHighlight(src));
	});

	it("underline what diagnose() finds, with the message on hover", () => {
		const html = staticHighlight(src, { errors: diagnose(src) });
		expect(plain(html.replace(/&quot;/g, `"`))).toBe(src);
		expect(html).toContain(`<span style="text-decoration:underline wavy #f59e0b;text-decoration-skip-ink:none;text-underline-offset:3px" title="JavaScript: Unexpected token (did you mean &quot;const&quot;?)"><span style="color:#9cdcfe">cosnt</span></span>`);
		expect(html).toContain(`title="ArcMoon: [end] has no open block to close"><span style="color:#c586c0;font-weight:bold">end</span></span>`);
	});

	it("can start inside a token, cover many tokens, and come from you", () => {
		const html = staticHighlight(`[p = title: "Hello"]x[end]`, { errors: [{ from: 13, to: 25, message: "a <lesson>" }] });
		expect(html).toContain(`title="a &lt;lesson&gt;"><span style="color:#ce9178">Hello"</span><span style="color:#c586c0">]</span><span style="color:#e8eaf0">x</span><span style="color:#c586c0">[</span><span style="color:#c586c0;font-weight:bold">end</span></span>`);
		expect(html).toContain(`<span style="color:#ce9178">"</span>`);
	});

	it("use classes with classPrefix", () => {
		const html = staticHighlight(src, { errors: diagnose(src), classPrefix: "arcm-" });
		expect(html).toContain(`<span class="arcm-error arcm-error-javascript" title=`);
		expect(html).toContain(`<span class="arcm-error arcm-error-arcmoon" title=`);
	});
});

describe("highlightJs", () => {
	it("colors keywords, calls, keys, properties, strings and comments", () => {
		const html = highlightJs(`const o = { k: "s" }; o.k.run(1); // c`);
		expect(html).toContain(span("color:#c586c0", "const"));
		expect(html).toContain(span("color:#9cdcfe", "k"));
		expect(html).toContain(span("color:#ce9178", `"s"`));
		expect(html).toContain(span("color:#dcdcaa", "run"));
		expect(html).toContain(span("color:#6a9955;font-style:italic", "// c"));
	});
});

// ###################
// Each error as "source: underlined text: message"
// ###################
const errors = (src, options) => diagnose(src, options).map((d) => `${d.source}: ${src.slice(d.from, d.to)}: ${d.message}`);

describe("errors", () => {
	it("give where each error is: offsets, line, column and text", () => {
		expect(diagnose("${ cosnt a = 1; }$\n[p]x[end][end]")).toEqual([
			{ from: 3, to: 8, line: 1, column: 4, text: "cosnt", severity: "error", source: "JavaScript", message: `Unexpected token (did you mean "const"?)` },
			{ from: 29, to: 32, line: 2, column: 11, text: "end", severity: "error", source: "ArcMoon", message: "[end] has no open block to close" }
		]);
	});

	it("finds nothing in good code", () => {
		expect(errors(`\${ const a = 1; }\$\n[p = t: \${ a }\$]\${ a }\$ runtime \${ a }\$[end]\nruntime \${ const b = () => { return 1; }; }\$`)).toEqual([]);
	});

	it("gives ArcMoon's errors", () => {
		expect(errors("[p][end][end]")).toEqual(["ArcMoon: end: [end] has no open block to close"]);
		expect(errors("${ const a = 1;\n[p]x[end]")).toEqual(["ArcMoon: ${: logic block is not closed with }$"]);
	});

	it("gives JavaScript errors where they are", () => {
		expect(errors("${ const a = (1 + 2; }$")).toEqual(["JavaScript: ;: Unexpected token"]);
		expect(errors("${ cosnt a = 1; }$")).toEqual([`JavaScript: cosnt: Unexpected token (did you mean "const"?)`]);
		expect(errors("[p = title: ${ a + }$]x[end]")).toEqual(["JavaScript: +: the code ends too early"]);
	});

	it("finds the JS mistake that hides the }$ (not \"logic block is not closed\")", () => {
		expect(errors(`\${ const a = "hi; }\$\n[p]x[end]`)).toEqual([`JavaScript: ": Unterminated string constant`]);
		expect(errors("${ if (a) { b(); }$\n[p]x[end]")).toEqual(["JavaScript: {: this { is never closed"]);
		expect(errors("[p]x[end]\nruntime ${ f(`a ${b} c); }$")).toEqual(["JavaScript: `: this template string is never closed"]);
	});

	it("gives ArcMoon and JavaScript errors together", () => {
		expect(errors("${ cosnt a = 1; }$\n[p]x[end][end]")).toEqual([
			`JavaScript: cosnt: Unexpected token (did you mean "const"?)`,
			"ArcMoon: end: [end] has no open block to close"
		]);
	});

	it("checks ArcMoon's rules for code", () => {
		expect(errors("[p]runtime ${ let x = 1 }$[end]")).toEqual([
			"ArcMoon: let x = 1: runtime ${ }$ in markup must be one expression (a live value). To run statements, move this runtime ${ }$ to the top level of the file."
		]);
		expect(errors(`[p = title: runtime \${ let x = 1 }\$]x[end]`)[0]).toContain(`runtime \${ }$ for "title" on [p] must be one expression`);
		expect(errors("runtime ${ export const a = 1; }$")).toEqual(["ArcMoon: export const a = 1;: export is not allowed in runtime code"]);
		expect(errors(`runtime \${ import fs from "node:fs"; import p from "path"; import d from "dayjs"; }\$`)).toEqual([
			`ArcMoon: "node:fs": runtime import "node:fs" is a Node.js module, which doesn't exist in the browser`,
			`ArcMoon: "path": runtime import "path" is a Node.js module, which doesn't exist in the browser`
		]);
		expect(errors("runtime ${ const n = 'a'; ArcMoon.defineRef(n); }$")).toEqual(["ArcMoon: ArcMoon.defineRef(n): ArcMoon.defineRef() needs a quoted name"]);
		expect(errors("${ return 1; const b = 2; }$")).toEqual(["ArcMoon: return 1;: return is only allowed as the last statement of ${ }$"]);
		expect(errors("${ ArcMoon.ref(x) }$")).toEqual(["ArcMoon: ArcMoon.ref(x): ArcMoon.ref() only works in runtime code"]);
		expect(errors(`[p = t: \${ import a from "a"; }\$]x[end]`)).toEqual([`ArcMoon: import a from "a";: import is only allowed in a \${ }$ block, not in a prop value`]);
		expect(errors("runtime ${ export const a = 1; }$", { rules: false })).toEqual([]);
	});
});

describe("the live editor", () => {	it("highlights, lists errors and gives the value back", async () => {
		const box = document.createElement("div");
		document.body.append(box);
		const messages = [];
		const lists = [];
		const updates = [];
		const editor = attachHighlighter(box, { onError: (m) => messages.push(m), onDiagnostics: (l) => lists.push(l), tokens: { IDENTIFIER: "red" } });
		editor.onUpdate((code) => updates.push(code));
		const spans = () => [...box.querySelectorAll(".cm-line span")];
		const linted = () => new Promise((done) => setTimeout(done, 400));

		editor.setValue("[p]Hi[end]");
		expect(editor.getValue()).toBe("[p]Hi[end]");
		expect(updates).toEqual(["[p]Hi[end]"]);
		expect(spans().find((e) => e.style.color === "red").textContent).toBe("p");
		await linted();
		expect(messages.at(-1)).toBeNull();

		editor.setValue("${ cosnt a = 1; }$\n[p]Hi[end][end]");
		await linted();
		expect(messages.at(-1)).toBe(`JavaScript: Unexpected token (did you mean "const"?)`);
		expect(lists.at(-1).map((d) => d.source)).toEqual(["JavaScript", "ArcMoon"]);
		expect(box.querySelector(".cm-lintRange-error.cm-arcm-error-js").textContent).toBe("cosnt");
		expect(box.querySelector(".cm-lintRange-error.cm-arcm-error-arcmoon").textContent).toBe("end");

		editor.goTo(lists.at(-1)[1]);
		const { from, to } = editor.view.state.selection.main;
		expect(editor.getValue().slice(from, to)).toBe("end");

		editor.destroy();
		expect(box.children.length).toBe(0);
	});

	it("gives class names with classPrefix, like staticHighlight", async () => {
		const box = document.createElement("div");
		document.body.append(box);
		const editor = attachHighlighter(box, { classPrefix: "arcm-", tokens: { KEY: "red" } });
		editor.setValue("[p = n: 1]${ go(x) }$[end]");
		const text = (cls) => [...box.querySelectorAll(`.${cls}`)].map((e) => e.textContent);
		expect(text("arcm-identifier")).toEqual(["p"]);
		expect(text("arcm-end-keyword")).toEqual(["end"]);
		expect(text("arcm-js-call")).toEqual(["go"]);
		expect(text("arcm-js-name")).toEqual(["x"]);
		expect([...box.querySelectorAll(".cm-line span")].find((e) => e.textContent === "n").style.color).toBe("red");
		expect(box.querySelector(".arcm-identifier").getAttribute("style")).toBeNull();
		editor.destroy();
	});

	it("still checks with showErrors: false, but draws nothing", async () => {
		const box = document.createElement("div");
		document.body.append(box);
		const lists = [];
		const editor = attachHighlighter(box, { showErrors: false, onDiagnostics: (l) => lists.push(l) });
		editor.setValue("[p][end][end]");
		await new Promise((done) => setTimeout(done, 400));
		expect(lists.at(-1).map((d) => d.message)).toEqual(["[end] has no open block to close"]);
		expect(box.querySelector(".cm-lintRange-error, .cm-gutter-lint")).toBeNull();
		editor.destroy();
	});

});
