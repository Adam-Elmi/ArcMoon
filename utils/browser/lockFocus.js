const resolveEl = (target) => {
	if (!target) return null;
	if (typeof Node !== "undefined" && target instanceof Node) return target;
	if (typeof target === "string" && typeof document !== "undefined") return document.querySelector(target);
	if (typeof target === "function") return target();
	return target.current ?? target.el ?? null;
};

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"area[href]",
	"input:not([disabled]):not([type=\"hidden\"])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"button:not([disabled])",
	"iframe",
	"object",
	"embed",
	"[contenteditable]:not([contenteditable=\"false\"])",
	"[tabindex]:not([tabindex=\"-1\"])",
	"audio[controls]",
	"video[controls]",
	"summary"
].join(",");

const isVisible = (el) => {
	if (!el || el.hidden) return false;
	if (el.getAttribute("aria-hidden") === "true") return false;
	if (typeof window !== "undefined" && window.getComputedStyle) {
		const style = window.getComputedStyle(el);
		if (style.display === "none" || style.visibility === "hidden") return false;
	}
	return true;
};

// ###################
// lockFocus(target, options?) -> dispose
// options: { initialFocus = true, returnFocus = true, preventScroll = false }
// ###################
export function lockFocus(target, options = {}) {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return () => {};
	}

	const container = resolveEl(target);
	if (!container) return () => {};

	const { initialFocus = true, returnFocus = true, preventScroll = false } = options;

	const prevActive = document.activeElement;

	const getFocusable = () => {
		const candidates = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
		return candidates.filter(isVisible);
	};

	// Perform initial focus
	if (initialFocus) {
		let toFocus = null;
		if (typeof initialFocus === "string") {
			toFocus = container.querySelector(initialFocus);
		} else if (typeof Node !== "undefined" && initialFocus instanceof Node) {
			toFocus = initialFocus;
		}

		if (!toFocus) {
			const focusables = getFocusable();
			toFocus = focusables[0] ?? null;
		}

		if (toFocus && typeof toFocus.focus === "function") {
			toFocus.focus({ preventScroll });
		} else {
			if (!container.hasAttribute("tabindex")) {
				container.setAttribute("tabindex", "-1");
			}
			container.focus?.({ preventScroll });
		}
	}

	const onKeyDown = (e) => {
		if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;

		const focusables = getFocusable();
		if (focusables.length === 0) {
			e.preventDefault();
			container.focus?.({ preventScroll });
			return;
		}

		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;

		if (e.shiftKey) {
			if (active === first || !container.contains(active)) {
				e.preventDefault();
				last.focus({ preventScroll });
			}
		} else {
			if (active === last || !container.contains(active)) {
				e.preventDefault();
				first.focus({ preventScroll });
			}
		}
	};

	const onFocusIn = (e) => {
		if (!container.contains(e.target)) {
			const focusables = getFocusable();
			const first = focusables[0] ?? container;
			first.focus?.({ preventScroll });
		}
	};

	document.addEventListener("keydown", onKeyDown, true);
	document.addEventListener("focusin", onFocusIn, true);

	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;

		document.removeEventListener("keydown", onKeyDown, true);
		document.removeEventListener("focusin", onFocusIn, true);

		if (returnFocus && prevActive && typeof prevActive.focus === "function" && prevActive.isConnected !== false) {
			try {
				prevActive.focus({ preventScroll });
			} catch {
				// Ignore if element cannot receive focus
			}
		}
	};
}
