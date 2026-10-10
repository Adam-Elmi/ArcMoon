// @vitest-environment jsdom
// ###################
// Browser API tests: render() and compile() in a DOM, with a stand-in worker
// ###################

import { describe, it, expect, vi, afterEach } from "vitest";
import { compileInWorker } from "../browser/compile.js";
import ArcMoon from "../browser/index.js";

const toModuleURL = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

// ###################
// Same messages as a real worker, cloned like postMessage does
// ###################
const fakeWorker = () => {
	const listeners = new Set();
	return {
		addEventListener: (_, f) => listeners.add(f),
		removeEventListener: (_, f) => listeners.delete(f),
		postMessage: async ({ id, request }) => {
			let data;
			try {
				data = structuredClone({ id, ok: true, result: await compileInWorker(request, { toModuleURL }) });
			} catch (err) {
				data = { id, ok: false, error: { name: err.name, message: err.message } };
			}
			listeners.forEach((f) => f({ data }));
		}
	};
};

const am = (options) => new ArcMoon({ worker: fakeWorker(), toModuleURL, ...options });
const tick = () => new Promise((r) => setTimeout(r, 50));

const mount = async (options) => {
	const host = document.createElement("div");
	host.append(await am(options).render());
	document.body.append(host);
	await tick();
	return host;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("render()", () => {
	it("returns a DocumentFragment of real elements", async () => {
		const fragment = await am({ src: `[main = class: "a  b"][p]Hi \${ 20 + 1 }\$[end][end]` }).render();
		expect(fragment).toBeInstanceOf(DocumentFragment);
		expect(fragment.querySelector("main").className).toBe("a b");
		expect(fragment.querySelector("p").textContent).toBe("Hi 21");
	});

	it("writes keys exactly as typed (B12)", async () => {
		const fragment = await am({ src: `[div = "data:x": "1", dataX: "2", dataFlag: true !]` }).render();
		const div = fragment.querySelector("div");
		expect(div.getAttributeNames().sort()).toEqual(["data:x", "dataflag", "datax"]);
		expect(div.getAttribute("data:x")).toBe("1");
		expect(div.getAttribute("datax")).toBe("2");
	});

	it("keeps the body of a [template] in its content", async () => {
		const fragment = await am({ src: `[template][li = class: "item"]x[end][end]` }).render();
		const template = fragment.querySelector("template");
		expect(template.content.querySelector("li.item").textContent).toBe("x");
	});

	it("turns { raw } HTML into elements", async () => {
		const fragment = await am({ src: `[div]\${ { raw: "<em>x</em><b>y</b>" } }\$[end]` }).render();
		expect(fragment.querySelector("em").textContent).toBe("x");
		expect(fragment.querySelector("b").textContent).toBe("y");
	});

	it("runs runtime code after insertion: signals, events, live attributes, refs", async () => {
		const host = await mount({
			src:
				`runtime \${\n  import { signal, computed } from "arcmoon/reactive";\n  const count = signal(0);\n  const hot = computed(() => count() > 1);\n  ArcMoon.ref(ArcMoon.defineRef("btn")).dataset.ready = "yes";\n}\$\n` +
				`[button = arcm-ref: "btn", class: runtime \${ hot() ? "hot" : "cold" }\$, onclick: runtime \${ () => count(count() + 1) }\$]runtime \${ count() }\$ clicks[end]`
		});
		const button = host.querySelector("button");
		expect(button.hasAttribute("data-arcm-ref")).toBe(false);
		expect(button.dataset.ready).toBe("yes");
		button.click();
		button.click();
		expect(button.textContent).toBe("2 clicks");
		expect(button.className).toBe("hot");
	});

	it("gives each component use its own runtime state", async () => {
		const host = await mount({
			src: `[import = Counter: "./Counter.arcm" !][Counter!][Counter!]`,
			files: {
				"Counter.arcm": `runtime \${ import { signal } from "arcmoon/reactive"; const n = signal(0); }\$\n[button = onclick: runtime \${ () => n(n() + 1) }\$]runtime \${ n() }\$[end]`
			}
		});
		const [a, b] = host.querySelectorAll("button");
		a.click();
		expect([a.textContent, b.textContent]).toEqual(["1", "0"]);
	});

	it("updates live values in a page [style] and -- props", async () => {
		const host = await mount({
			src:
				`runtime \${ import { signal } from "arcmoon/reactive"; const c = signal("red"); const w = signal("10px"); }\$\n` +
				`[style]p { color: runtime \${ c() }\$; }[end]\n` +
				`[p = --w: runtime \${ w() }\$, onclick: runtime \${ () => { c("blue"); w("20px"); } }\$]x[end]`
		});
		const p = host.querySelector("p");
		expect(host.querySelector("style").textContent).toBe("p { color: red; }");
		expect(p.style.getPropertyValue("--w")).toBe("10px");
		p.click();
		expect(host.querySelector("style").textContent).toBe("p { color: blue; }");
		expect(p.style.getPropertyValue("--w")).toBe("20px");
	});

	it("updates live css. props", async () => {
		const host = await mount({
			src:
				`runtime \${ import { signal } from "arcmoon/reactive"; const w = signal(10); }\$\n` +
				`[p = css.width: runtime \${ w() + "px" }\$, css.color: runtime \${ w() > 10 ? "red" : false }\$, onclick: runtime \${ () => w(20) }\$]x[end]`
		});
		const p = host.querySelector("p");
		expect(p.style.getPropertyValue("width")).toBe("10px");
		expect(p.style.getPropertyValue("color")).toBe("");
		p.click();
		expect(p.style.getPropertyValue("width")).toBe("20px");
		expect(p.style.getPropertyValue("color")).toBe("red");
	});

	it("collects a shared ref from several components, in page order", async () => {
		const host = await mount({
			src: `[import = A: "./A.arcm" !][import = B: "./B.arcm" !]\n[B!][A!][B!]\nruntime \${ ArcMoon.refs(ArcMoon.defineRef("btn")).forEach((b, i) => (b.dataset.i = i)); }\$`,
			files: {
				"A.arcm": `[button = arcm-shared-ref: "btn"]a[end]`,
				"B.arcm": `[button = arcm-shared-ref: "btn"]b[end]`
			}
		});
		expect([...host.querySelectorAll("button")].map((b) => b.textContent + b.dataset.i)).toEqual(["b0", "a1", "b2"]);
	});

	it("names the files when a ref can't be collected", async () => {
		const files = { "A.arcm": `[button = arcm-ref: "btn"]a[end]`, "B.arcm": `[button = arcm-shared-ref: "btn"]b[end]` };
		const src = (uses) => `[import = A: "./A.arcm" !][import = B: "./B.arcm" !]\n${uses}\nruntime \${ ArcMoon.defineRef("btn"); }\$`;
		await expect(am({ src: src("[A!][B!]"), files }).render()).rejects.toThrow(
			/anonymous\.arcm:3:12 {2}ref "btn" is attached in more than one component: A\.arcm \(arcm-ref\), B\.arcm \(arcm-shared-ref\)\. A parent can only collect shared refs/
		);
		await expect(am({ src: src("[A!][A!]"), files }).render()).rejects.toThrow(/more than one component: A\.arcm \(arcm-ref\) ×2\./);
	});

	it("loads runtime imports from files and the packages map", async () => {
		const host = await mount({
			src: `runtime \${ import { add } from "./add.js"; import shout from "shout"; const out = shout(String(add(2, 3))); }\$\n[p]runtime \${ out }\$[end]`,
			files: { "add.js": "export const add = (a, b) => a + b;" },
			packages: { shout: toModuleURL(`export default (s) => s + "!";`) }
		});
		expect(host.querySelector("p").textContent).toBe("5!");
	});

	it("loads [script = src] files from files", async () => {
		await mount({
			src: `[p]a[end][script = src: "./lib/app.js" !]`,
			files: { "lib/app.js": `import { two } from "./two.js"; window.__fromScript = two * 21;`, "lib/two.js": "export const two = 2;" }
		});
		expect(window.__fromScript).toBe(42);
	});

	it("rejects node: modules in runtime code", async () => {
		await expect(am({ src: `runtime \${ import fs from "node:fs"; }\$[p]a[end]` }).render()).rejects.toThrow(/"node:fs" is a Node\.js module/);
	});

	it("passes worker errors and warnings on", async () => {
		await expect(am({ src: `[p]\${ nope() }\$[end]` }).render()).rejects.toThrow(/anonymous\.arcm:1:7 {2}ReferenceError: nope is not defined/);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await am({ src: `[dvi]x[end]` }).render();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("did you mean [div]"));
		warn.mockRestore();
	});
});

describe("compile() in the browser", () => {
	it("gives the same HTML as render() for markup", async () => {
		const src = `[import = Card: "./Card.arcm" !]\n[main][Card = title: "A & B" !][svg = viewBox: "0 0 1 1"][circle = r: 1 !][end][input = checked: true, disabled: false !][end]`;
		const files = { "Card.arcm": `\${ const { title } = ArcMoon.props(); }\$[div = class: "card"][h2]\${ title }\$[end][end]` };
		const fromString = document.createElement("div");
		fromString.innerHTML = await am({ src, files }).compile();
		const fromDom = document.createElement("div");
		fromDom.append(await am({ src, files }).render());
		expect(fromDom.innerHTML).toBe(fromString.innerHTML);
	});

	it("adds runtime code as one inline module script", async () => {
		const html = await am({ src: `runtime \${ const n = 1; }\$\n[p]runtime \${ n }\$[end]` }).compile();
		expect(html.match(/<script type="module">/g)).toHaveLength(1);
		expect(html).toContain(`<p><!--arcm:t0--><!--/arcm--></p>`);
	});

	it("runs without the compiling window's globals, like in an iframe (B20)", async () => {
		const html = await am({
			src: `runtime \${\n  import { signal } from "arcmoon/reactive";\n  const count = signal(0);\n}\$\n[button = onclick: runtime \${ () => count(count() + 1) }\$]runtime \${ count() }\$[end]`
		}).compile();
		const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
		document.body.innerHTML = html.replace(/<script[\s\S]*<\/script>/, "");
		delete globalThis.__arcmReactive;
		delete globalThis.__arcmClient;
		await import(/* @vite-ignore */ toModuleURL(script));
		await tick();
		const button = document.querySelector("button");
		button.click();
		button.click();
		expect(button.textContent).toBe("2");
		expect(globalThis.__arcmClient).toBeUndefined();
	});
});

describe("render() with shared refs (B21)", () => {
	it("each element with a shared ref runs its own handler", async () => {
		const host = await mount({
			src: `runtime \${ window.clicked = []; ArcMoon.refs(ArcMoon.defineRef("item")); }\$\n[button = arcm-shared-ref: "item", onclick: runtime \${ () => window.clicked.push("A") }\$]A[end][button = arcm-shared-ref: "item", onclick: runtime \${ () => window.clicked.push("B") }\$]B[end]`
		});
		const [a, b] = host.querySelectorAll("button");
		b.click();
		a.click();
		expect(window.clicked).toEqual(["B", "A"]);
	});
});

describe("browser timeout", () => {
	it("terminates a worker that never answers, and says why", async () => {
		const stuck = { addEventListener() {}, removeEventListener() {}, postMessage() {}, terminated: false, terminate() { this.terminated = true; } };
		const started = Date.now();
		await expect(new ArcMoon({ src: "${ while (true) {} }$", worker: stuck, timeout: 200 }).render()).rejects.toThrow(/\$\{ \}\$ code took longer than 200 ms and was stopped/);
		expect(stuck.terminated).toBe(true);
		expect(Date.now() - started).toBeLessThan(2000);
	});
});

// ###################
// A stand-in for the browser's Worker: holds messages until it has "loaded"
// (after startMs), then says ready, like browser/worker.js. fail: it never loads
// ###################
describe("browser worker start (B19)", () => {
	let workers;
	const setup = async ({ startMs = 0, mode = "ok" } = {}) => {
		workers = [];
		class FakeWorker {
			constructor() {
				this.listeners = { message: new Set(), error: new Set() };
				this.queue = [];
				this.mode = setup.mode ?? mode;
				workers.push(this);
				setTimeout(() => {
					if (this.mode === "fail") return this.emit("error", { message: "404 worker.js" });
					this.loaded = true;
					this.emit("message", { data: { ready: true } });
					this.queue.splice(0).forEach((m) => this.postMessage(m));
				}, startMs);
			}
			addEventListener(type, f) { this.listeners[type].add(f); }
			removeEventListener(type, f) { this.listeners[type].delete(f); }
			emit(type, event) { [...this.listeners[type]].forEach((f) => f(event)); }
			terminate() { this.terminated = true; }
			async postMessage(message) {
				if (!this.loaded) return this.queue.push(message);
				if (this.mode === "stuck") return;
				const { id, request } = message;
				let data;
				try {
					data = structuredClone({ id, ok: true, result: await compileInWorker(request, { toModuleURL }) });
				} catch (err) {
					data = { id, ok: false, error: { name: err.name, message: err.message } };
				}
				this.emit("message", { data });
			}
		}
		vi.stubGlobal("Worker", FakeWorker);
		URL.createObjectURL ??= () => "blob:arcmoon-test";
		vi.resetModules();
		return (await import("../browser/index.js")).default;
	};
	afterEach(() => {
		vi.unstubAllGlobals();
		delete setup.mode;
	});

	it("doesn't count a slow worker start as ${ }$ time", async () => {
		const Fresh = await setup({ startMs: 900 });
		expect(await new Fresh({ src: "[p]${ 1 + 1 }$[end]", timeout: 200 }).compile()).toBe("<p>2</p>");
	});

	it("still stops ${ }$ that never finishes, once the worker is ready", async () => {
		const Fresh = await setup({ startMs: 50, mode: "stuck" });
		await expect(new Fresh({ src: "${ while (true) {} }$", timeout: 200 }).compile()).rejects.toThrow(/\$\{ \}\$ code took longer than 200 ms and was stopped/);
		expect(workers[0].terminated).toBe(true);
	});

	it("says when the worker can't start, and starts a new one next time", async () => {
		const Fresh = await setup({ mode: "fail" });
		await expect(new Fresh({ src: "[p]a[end]" }).compile()).rejects.toThrow(/couldn't start ArcMoon's worker \(.*worker\.js\): 404 worker\.js/);
		expect(workers[0].terminated).toBe(true);
		setup.mode = "ok";
		expect(await new Fresh({ src: "[p]a[end]" }).compile()).toBe("<p>a</p>");
		expect(workers).toHaveLength(2);
	});
});
