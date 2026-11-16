// onScroll(target, cb, options) -> dispose
// target: window (or null) or any scrollable element. cb({ x, y, dx, dy, direction }) runs at most once per frame.
// direction is "down", "up" or null (horizontal-only scroll)
export function onScroll(target, cb, options = {}) {
	if (typeof window === "undefined") return () => {};

	const el = target ?? window;
	const isWindow = el === window;
	const read = () => (isWindow ? { x: window.scrollX, y: window.scrollY } : { x: el.scrollLeft, y: el.scrollTop });

	let prev = read();
	let frame = 0;

	const flush = () => {
		frame = 0;
		const { x, y } = read();
		const dx = x - prev.x;
		const dy = y - prev.y;
		prev = { x, y };
		if (dx === 0 && dy === 0) return;
		cb({ x, y, dx, dy, direction: dy > 0 ? "down" : dy < 0 ? "up" : null });
	};

	const listener = () => {
		if (!frame) frame = requestAnimationFrame(flush);
	};

	el.addEventListener("scroll", listener, { passive: options.passive ?? true });

	return () => {
		el.removeEventListener("scroll", listener);
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
	};
}