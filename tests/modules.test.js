// ###################
// Module system tests
// ###################

import { describe, it, expect } from "vitest";
import loadModules, { ModuleError, COMPONENT } from "../core/modules.js";

const files = {
	"/p/Card.arcm": `[import = Badge: "@/Badge.arcm" !]\n[div][Badge = "x" !][slot!][end]`,
	"/p/lib/Badge.arcm": `[span]x[end]`,
	"/p/A.arcm": `[import = B: "./B.arcm" !][B!]`,
	"/p/B.arcm": `[import = A: "./A.arcm" !][A!]`
};

const host = {
	resolve: (p, from) => (p.startsWith("/") ? p : from.slice(0, from.lastIndexOf("/") + 1) + p.replace(/^\.\//, "")),
	readFile: async (f) => {
		if (!(f in files)) throw new Error("not found");
		return files[f];
	}
};

const load = (src, options) => loadModules({ id: "/p/page.arcm", src }, host, options);

describe("modules", () => {
	it("says when an import looks like an alias that isn't set", async () => {
		await expect(load(`[import = Card: "./Card.arcm" !]`)).rejects.toThrow(/"@" isn't an import alias here\. Aliases come from importAliases in arcmoon\.config\.js/);
		await expect(load(`[import = X: "~ui/X.arcm" !]`)).rejects.toThrow(/"~ui" isn't an import alias here/);
		await expect(load(`[import = X: "./Nope.arcm" !]`)).rejects.toThrow(/can't read "\.\/Nope\.arcm" \(\/p\/Nope\.arcm\): not found/);
	});

	it("loads the import tree and marks components", async () => {
		const g = await load(`[import = Card: "./Card.arcm" !]\n[Card = title: "Hi"]Body[end:Card]`, { importAliases: { "@": "/p/lib" } });
		expect([...g.modules.keys()].sort()).toEqual(["/p/Card.arcm", "/p/lib/Badge.arcm", "/p/page.arcm"]);
		const card = g.modules.get("/p/page.arcm").ast.find((n) => n.type === COMPONENT);
		expect(card).toMatchObject({ name: "Card", module: "/p/Card.arcm", props: { title: "Hi" } });
	});

	it("marks components inside other blocks", async () => {
		const g = await load(`[import = Card: "./Card.arcm" !][for-each = \${ xs }\$, as: "x"][Card!][end]`, { importAliases: { "@": "/p/lib" } });
		const loop = g.modules.get("/p/page.arcm").ast.find((n) => n.type === "ForEach");
		expect(loop.body[0].type).toBe(COMPONENT);
	});

	it.each([
		[`[import = B: "./B.arcm" !]`, /circular import/],
		[`[import = X: "./missing.arcm" !]`, /can't read "\.\/missing\.arcm"/],
		[`[import = X: "./lib/Badge.arcm" !]\n[import = X: "./lib/Badge.arcm" !]`, /"X" is imported twice/],
		[`[import = X: "./data.json" !]`, /only loads \.arcm files/]
	])("rejects %s", async (src, message) => {
		await expect(load(src)).rejects.toThrow(ModuleError);
		await expect(load(src)).rejects.toThrow(message);
	});
});
