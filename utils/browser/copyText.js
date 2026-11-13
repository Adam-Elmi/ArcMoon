// ###################
// Extract string from text, element, or input
// ###################
function extractText(target) {
	if (target == null) return "";
	if (typeof target === "object" && target.nodeType) {
		if ("value" in target && typeof target.value === "string") {
			return target.value;
		}
		return target.innerText?.trim() ?? target.textContent?.trim() ?? "";
	}
	return String(target);
}

// ###################
// Fallback for non-secure contexts (http:// on mobile, older Safari, webviews)
// ###################
function fallbackCopy(text) {
	if (typeof document === "undefined") return false;

	const textarea = document.createElement("textarea");
	textarea.value = text;

	// Prevent mobile Safari viewport zoom (< 16px zooms) and scrolling
	textarea.setAttribute("readonly", "");
	textarea.style.contain = "strict";
	textarea.style.position = "fixed";
	textarea.style.left = "-9999px";
	textarea.style.top = "0";
	textarea.style.fontSize = "16px";
	textarea.style.opacity = "0";

	document.body.appendChild(textarea);

	// Save existing user selection if any
	const selection = document.getSelection();
	const prevRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

	textarea.focus({ preventScroll: true });
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);

	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}

	textarea.remove();

	// Restore original selection
	if (selection && prevRange) {
		selection.removeAllRanges();
		selection.addRange(prevRange);
	}

	return ok;
}

// ###################
// copyText(target, options) -> Promise<boolean>
// Copies text from string or DOM element to clipboard via Clipboard API or fallback.
// ###################
export async function copyText(target, options = {}) {
	const str = extractText(target);
	let ok = false;
	let lastError = null;

	// 1. Try modern Clipboard API (https:// or localhost)
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(str);
			ok = true;
		} catch (err) {
			lastError = err;
		}
	}

	// 2. Try mobile/HTTP fallback
	if (!ok) {
		try {
			ok = fallbackCopy(str);
		} catch (err) {
			lastError = err;
		}
	}

	// 3. Error reporting (ArcMoon warning style)
	if (!ok) {
		const err = lastError ?? new Error("Clipboard copy is not supported in this environment");
		if (typeof options.onError === "function") {
			options.onError(err);
		} else if (!options.quiet) {
			console.warn(`⚠ [arcmoon/utils] copyText failed: ${err.message}`);
		}
		if (options.throwOnError) throw err;
	}

	return ok;
}
