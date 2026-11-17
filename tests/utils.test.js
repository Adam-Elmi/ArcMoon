// ###################
// Tests for arcmoon/utils (limit, lockFocus, etc.)
// ###################

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { limit } from "../utils/browser/limit.js";
import { lockFocus } from "../utils/browser/lockFocus.js";
import ArcMoon from "../node/compiler.js";

describe("limit (throttle)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("throws TypeError if target is not a function", () => {
		expect(() => limit(null)).toThrow(TypeError);
		expect(() => limit(123)).toThrow(TypeError);
	});

	it("calls immediately on the first call (leading: true) and throttles subsequent calls", () => {
		const fn = vi.fn();
		const throttled = limit(fn, 100);

		throttled("call 1");
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith("call 1");

		throttled("call 2");
		throttled("call 3");
		expect(fn).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith("call 3");
	});

	it("supports cancel() to abort trailing execution", () => {
		const fn = vi.fn();
		const throttled = limit(fn, 100);

		throttled("a");
		expect(fn).toHaveBeenCalledTimes(1);

		throttled("b");
		throttled.cancel();

		vi.advanceTimersByTime(150);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("supports flush() to immediately trigger pending trailing call", () => {
		const fn = vi.fn();
		const throttled = limit(fn, 100);

		throttled("a");
		expect(fn).toHaveBeenCalledTimes(1);

		throttled("b");
		throttled.flush();
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith("b");

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("supports leading: false", () => {
		const fn = vi.fn();
		const throttled = limit(fn, 100, { leading: false });

		throttled("first");
		expect(fn).toHaveBeenCalledTimes(0);

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith("first");
	});

	it("supports trailing: false", () => {
		const fn = vi.fn();
		const throttled = limit(fn, 100, { trailing: false });

		throttled("first");
		expect(fn).toHaveBeenCalledTimes(1);

		throttled("second");
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe("lockFocus", () => {
	let dom;
	let window;
	let document;

	beforeEach(() => {
		dom = new JSDOM(
			`<!DOCTYPE html>
			<html>
			<body>
				<button id="outside-before">Outside Before</button>
				<div id="modal">
					<input id="input-1" type="text" />
					<button id="btn-1">Submit</button>
					<button id="btn-cancel">Cancel</button>
				</div>
				<button id="outside-after">Outside After</button>
			</body>
			</html>`,
			{ url: "http://localhost" }
		);
		window = dom.window;
		document = window.document;
		globalThis.window = window;
		globalThis.document = document;
		globalThis.Node = window.Node;
	});

	afterEach(() => {
		delete globalThis.window;
		delete globalThis.document;
		delete globalThis.Node;
	});

	it("returns a noop dispose when target does not exist", () => {
		const dispose = lockFocus(null);
		expect(typeof dispose).toBe("function");
		dispose();
	});

	it("focuses the first focusable element by default and traps Tab / Shift+Tab", () => {
		const modal = document.getElementById("modal");
		const input1 = document.getElementById("input-1");
		const btnCancel = document.getElementById("btn-cancel");
		const outsideBtn = document.getElementById("outside-before");

		outsideBtn.focus();
		expect(document.activeElement).toBe(outsideBtn);

		const unlock = lockFocus(modal, { returnFocus: true });
		expect(document.activeElement).toBe(input1);

		// Press Tab on the last element -> should cycle to first
		btnCancel.focus();
		const tabEvent = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
		document.dispatchEvent(tabEvent);
		expect(tabEvent.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(input1);

		// Press Shift+Tab on first element -> should cycle to last
		input1.focus();
		const shiftTabEvent = new window.KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey: true,
			bubbles: true,
			cancelable: true
		});
		document.dispatchEvent(shiftTabEvent);
		expect(shiftTabEvent.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(btnCancel);

		// Release lock -> restores focus to outsideBtn
		unlock();
		expect(document.activeElement).toBe(outsideBtn);
	});

	it("re-focuses container/first element on focusin outside", () => {
		const modal = document.getElementById("modal");
		const input1 = document.getElementById("input-1");
		const outsideAfter = document.getElementById("outside-after");

		const unlock = lockFocus(modal);
		expect(document.activeElement).toBe(input1);

		// Simulate focus event landing outside container
		const focusEvent = new window.FocusEvent("focusin", { bubbles: true });
		Object.defineProperty(focusEvent, "target", { value: outsideAfter });
		document.dispatchEvent(focusEvent);

		expect(document.activeElement).toBe(input1);
		unlock();
	});
});

describe("compiler integration with arcmoon/utils", () => {
	it("bundles and executes limit and lockFocus from arcmoon/utils", async () => {
		const code = `
			runtime \${
				import { limit, lockFocus } from "arcmoon/utils";
				window.__hasLimit = typeof limit === "function";
				window.__hasLockFocus = typeof lockFocus === "function";
			}\$
			[p]test[end]
		`;
		const compiler = new ArcMoon({ src: code });
		const html = await compiler.compile();
		const win = new JSDOM(html.replace(`<script type="module">`, "<script>"), { runScripts: "dangerously" }).window;

		expect(win.__hasLimit).toBe(true);
		expect(win.__hasLockFocus).toBe(true);
	});
});
