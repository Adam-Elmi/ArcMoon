// ###################
// Lexer tests
// ###################

import { describe, it, expect } from "vitest";
import lexer, { TOKEN_TYPES as T, LexerError } from "../core/lexer.js";

const kinds = (src) =>
	lexer(src)
		.filter((t) => t.type !== T.WHITESPACE && t.type !== T.EOF)
		.map((t) => `${t.type}(${t.value})`);

describe("lexer", () => {
	it("reads a block header with props", () => {
		expect(kinds(`[Card = title: "Hi", n: 10, neg: -2.5, ok: true]body[end:Card]`)).toEqual([
			"OPEN_BRACKET([)", "IDENTIFIER(Card)", "EQUAL(=)",
			"KEY(title)", "COLON(:)", "STRING(Hi)", "COMMA(,)",
			"KEY(n)", "COLON(:)", "NUMBER(10)", "COMMA(,)",
			"KEY(neg)", "COLON(:)", "NUMBER(-2.5)", "COMMA(,)",
			"KEY(ok)", "COLON(:)", "BOOLEAN(true)", "CLOSE_BRACKET(])",
			"TEXT(body)", "OPEN_BRACKET([)", "END_KEYWORD(end:Card)", "CLOSE_BRACKET(])"
		]);
	});

	it("marks unquoted values as WORD", () => {
		expect(kinds(`[User = id: AKZB !]`)).toContain("WORD(AKZB)");
	});

	it("unescapes quotes inside strings", () => {
		expect(kinds(`[a = t: "say \\"hi\\""]x[end]`)).toContain(`STRING(say "hi")`);
	});

	it("keeps [ as text when no name follows", () => {
		expect(kinds(`text ["key"] and a]b`)).toEqual([`TEXT(text ["key"] and a]b)`]);
	});

	it("reads self-closing blocks", () => {
		expect(kinds(`[br!]`)).toEqual(["OPEN_BRACKET([)", "IDENTIFIER(br)", "EXCLAMATION_MARK(!)", "CLOSE_BRACKET(])"]);
		expect(kinds(`[img = width: 100!]`)).toContain("NUMBER(100)");
		expect(kinds(`[a = alt: "Hi!" !]`)).toContain("STRING(Hi!)");
	});

	it("reads ${ }$ with JS strings inside", () => {
		expect(kinds(`\${ const s = "}$"; }\$ after`)).toEqual([
			"LOGIC_OPEN(${)", `LOGIC( const s = "}$"; )`, "LOGIC_CLOSE(}$)", "TEXT(after)"
		]);
	});

	it("reads runtime ${ }$ in props and text", () => {
		const t = kinds(`[b = onclick: runtime \${ go() }\$]runtime \${ n() }\$[end]`);
		expect(t.filter((x) => x === "RUNTIME_KEYWORD(runtime)")).toHaveLength(2);
	});

	it("reads runtime right after }$", () => {
		expect(kinds(`\${ a }\$runtime \${ b }\$`)).toContain("RUNTIME_KEYWORD(runtime)");
		expect(kinds(`myruntime \${ b }\$`)[0]).toBe("TEXT(myruntime )");
	});

	it("keeps arcm-raw bodies as text", () => {
		expect(kinds(`[code = arcm-raw: true]a [b] \\[end][end:code]`)).toContain("TEXT(a [b] [end])");
	});

	it("does not read a raw body for a self-closing block", () => {
		expect(kinds(`[code = arcm-raw: true !]after [b]`)).toContain("IDENTIFIER(b)");
	});

	it("reads comments without their markers", () => {
		expect(kinds(`# one\n### two\nlines ###`)).toEqual(["COMMENT( one)", "COMMENT_BLOCK( two\nlines )"]);
	});

	it("tracks positions", () => {
		const t = lexer("[p]\nhi[end]");
		expect(t[4].range).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 2 } });
	});

	it("throws on broken input", () => {
		expect(() => lexer(`[a = x: "open`)).toThrow(LexerError);
		expect(() => lexer("${ oops")).toThrow(/not closed with \}\$/);
		expect(() => lexer("a \\ b")).toThrow(/must be followed by a character/);
	});

	it("reads template literals nested inside ${ } of a template literal", () => {
		const code = (src) => lexer(src).find((t) => t.type === T.LOGIC).value;
		const nested = "b = `${a ? `<p>N</p><p>${list.map((n) => `<a href=\"#${n}\">${n}</a>`).join(\"\")}</p>` : `<p>none</p>`}`;";
		expect(code(`runtime \${ ${nested} }\$`).trim()).toBe(nested);
		expect(code("${ u = `${ x ? `see https://a.org/${y}` : '' }`; }$").trim()).toBe("u = `${ x ? `see https://a.org/${y}` : '' }`;");
		expect(code("${ t = `${ `}$` }`; }$").trim()).toBe("t = `${ `}$` }`;");
		expect(code("${ o = `a ${ { k: 1 }.k } b`; }$").trim()).toBe("o = `a ${ { k: 1 }.k } b`;");
	});
});
