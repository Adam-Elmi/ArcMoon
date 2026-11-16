// onFrame(cb, options) -> dispose
// cb({ time, dt, frame }): dt and time are in seconds; dt is clamped to options.maxDelta
export function onFrame(cb, options = {}) {
	if (typeof window === "undefined" || !window.requestAnimationFrame) return () => {};

	const { maxDelta = 0.1 } = options;
	let id = 0;
	let stopped = false;
	let start = null;
	let last = null;
	let frame = 0;

	const tick = (now) => {
		if (stopped) return;
		if (start === null) start = last = now;

		// A hidden tab pauses rAF; clamp so the first frame back doesn't jump
		const dt = Math.min((now - last) / 1000, maxDelta);
		last = now;

		cb({ time: (now - start) / 1000, dt, frame: frame++ });
		if (!stopped) id = requestAnimationFrame(tick);
	};

	id = requestAnimationFrame(tick);

	return () => {
		stopped = true;
		cancelAnimationFrame(id);
	};
}