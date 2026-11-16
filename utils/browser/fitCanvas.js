const resolveEl = (target) => {
	if (!target) return null;
	if (typeof Node !== "undefined" && target instanceof Node) return target;
	if (typeof target === "function") return target();
	return target.current ?? target.el ?? null;
};

// ###################
// fitCanvas(target, draw?, options?) -> { ctx, refit, dispose }
// ###################
export function fitCanvas(target, draw, options = {}) {
	const noop = { ctx: null, refit: () => {}, dispose: () => {} };
	if (typeof window === "undefined") return noop;

	const canvas = resolveEl(target);
	if (!canvas || typeof canvas.getContext !== "function") return noop;

	const ctx = canvas.getContext(options.type ?? "2d", options.context);
	if (!ctx) return noop;

	let disposed = false;
	let dprQuery = null;

	const refit = () => {
		if (disposed) return;
		const rect = canvas.getBoundingClientRect();
		const width = Math.round(rect.width);
		const height = Math.round(rect.height);
		if (width === 0 || height === 0) return;

		const dpr = window.devicePixelRatio || 1;
		const pw = Math.round(width * dpr);
		const ph = Math.round(height * dpr);

		// Assigning width/height clears the canvas
		if (canvas.width !== pw || canvas.height !== ph) {
			canvas.width = pw;
			canvas.height = ph;
		}
		if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (typeof draw === "function") draw({ ctx, width, height, dpr });
	};

	// ###################
	// devicePixelRatio has no event
	// ###################
	const watchDpr = () => {
		if (!window.matchMedia) return;
		dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
		dprQuery.addEventListener("change", onDprChange, { once: true });
	};
	const onDprChange = () => {
		refit();
		watchDpr();
	};

	let observer = null;
	if (typeof ResizeObserver !== "undefined") {
		observer = new ResizeObserver(refit);
		observer.observe(canvas);
	}
	watchDpr();
	refit();

	return {
		ctx,
		refit,
		dispose() {
			disposed = true;
			observer?.disconnect();
			dprQuery?.removeEventListener("change", onDprChange);
		}
	};
}