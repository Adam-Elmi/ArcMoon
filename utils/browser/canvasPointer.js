const resolveEl = (target) => {
	if (!target) return null;
	if (typeof Node !== "undefined" && target instanceof Node) return target;
	if (typeof target === "function") return target();
	return target.current ?? target.el ?? null;
};

// canvasPointer(target, handlers, options) -> dispose
// handlers: down({ x, y }), move({ x, y, dragging }), up({ x, y, cancelled })
// each also gets { pointerType, event }; x/y are canvas CSS pixels
export function canvasPointer(target, handlers = {}, options = {}) {
	if (typeof window === "undefined") return () => {};

	const canvas = resolveEl(target);
	if (!canvas || typeof canvas.addEventListener !== "function") return () => {};

	const { down, move, up } = handlers;
	const prevTouchAction = canvas.style.touchAction;
	canvas.style.touchAction = options.touchAction ?? "none";

	let activeId = null;

	const point = (e, extra) => {
		const rect = canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top, pointerType: e.pointerType, event: e, ...extra };
	};

	const release = (id) => {
		try {
			if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
		} catch {}
	};

	const onDown = (e) => {
		if (activeId !== null) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		activeId = e.pointerId;
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {}
		down?.(point(e));
	};

	const onMove = (e) => {
		if (activeId !== null && e.pointerId !== activeId) return;
		move?.(point(e, { dragging: activeId !== null }));
	};

	const finish = (cancelled) => (e) => {
		if (e.pointerId !== activeId) return;
		activeId = null;
		release(e.pointerId);
		up?.(point(e, { cancelled }));
	};
	const onUp = finish(false);
	const onCancel = finish(true);

	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointermove", onMove);
	canvas.addEventListener("pointerup", onUp);
	canvas.addEventListener("pointercancel", onCancel);

	return () => {
		canvas.removeEventListener("pointerdown", onDown);
		canvas.removeEventListener("pointermove", onMove);
		canvas.removeEventListener("pointerup", onUp);
		canvas.removeEventListener("pointercancel", onCancel);
		if (activeId !== null) release(activeId);
		activeId = null;
		canvas.style.touchAction = prevTouchAction;
	};
}