// ###################
// Parser tests
// ###################

import { describe, it, expect } from "vitest";
import lexer from "../core/lexer.js";
import parser, { ParserError } from "../core/parser.js";

const parse = (src) => parser(lexer(src, "t.arcm"));
const clean = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "range" ? undefined : v)));

describe("parser", () => {
	it("builds blocks with props and directives", () => {
		const [block] = clean(parse(`[Card = title: "Hi", n: 10, ok: true, "New", arcm-ref: "c"]Body[end:Card]`));
		expect(block).toEqual({
			type: "Block",
			id: "Card",
			props: { 0: "New", title: "Hi", n: 10, ok: true },
			directives: { ref: "c" },
			isSelfClosing: false,
			body: [{ type: "Text", text: "Body" }]
		});
	});

	it("joins text, spaces and escapes", () => {
		const [block] = clean(parse(`[p]a \\# b[end]`));
		expect(block.body).toEqual([{ type: "Text", text: "a # b" }]);
	});

	it("builds import, slot and for-each nodes", () => {
		const ast = clean(parse(`[import = Card: "./Card.arcm" !][slot!][for-each = \${ xs }\$, as: "x"]a[end]`));
		expect(ast[0]).toEqual({ type: "Import", name: "Card", path: "./Card.arcm" });
		expect(ast[1]).toEqual({ type: "Slot", props: {}, body: [] });
		expect(ast[2]).toMatchObject({ type: "ForEach", as: "x", key: null, source: { type: "StaticLogic", code: " xs " } });
	});

	it("keeps runtime values in props", () => {
		const [block] = clean(parse(`[button = onclick: runtime \${ go() }\$]x[end]`));
		expect(block.props.onclick).toEqual({ type: "RuntimeLogic", code: " go() ", codeStart: { line: 0, character: 29 } });
	});

	it.each([
		[`[User = id: AKZB !]`, /unquoted value AKZB for prop "id"/],
		[`[div]x`, /missing \[end\]/],
		[`[div]x[end:span]`, /does not match \[div\]/],
		[`x[end]`, /no open block to close/],
		[`[p]a[end][import = A: "a.arcm" !]`, /must be at the top of the file/],
		[`[a ! = x: 1]`, /! must come right before \]/],
		[`[a = x: 1, x: 2]`, /written twice/],
		[`[a = x: 1,]`, /unexpected , before \]/],
		[`[import = A: "a.arcm"][end]`, /must be self-closing/],
		[`[for-each = "x"]a[end]`, /needs an array first/]
	])("rejects %s", (src, message) => {
		expect(() => parse(src)).toThrow(ParserError);
		expect(() => parse(src)).toThrow(message);
	});
});
