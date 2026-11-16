// scrollTo(target, options) -> Promise<boolean>
// target: element, CSS selector, or a number (absolute y; offset is ignored for numbers)
// options: { offset = 0, container = window, behavior = "smooth", timeout = 3000 }
export function scrollTo(target, options = {}) {
	if (typeof window === "undefined") return Promise.resolve(false);

	const { offset = 0, container, timeout = 3000 } = options;
	let { behavior = "smooth" } = options;

	const box = container ?? window;
	const isWindow = box === window;
	const current = () => (isWindow ? window.scrollY : box.scrollTop);
	const max = () => (isWindow ? document.documentElement.scrollHeight - window.innerHeight : box.scrollHeight - box.clientHeight);

	let top;
	if (typeof target === "number") {
		top = target;
	} else {
		const el = typeof target === "string" ? document.querySelector(target) : target;
		if (!el) return Promise.resolve(false);
		const base = isWindow ? 0 : box.getBoundingClientRect().top;
		top = el.getBoundingClientRect().top - base + current() - offset;
  }
	
	top = Math.max(0, Math.min(top, max()));

	if (behavior === "smooth" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) behavior = "auto";
	if (Math.abs(top - current()) < 1) return Promise.resolve(true);

	return new Promise((resolve) => {
		let idle = 0;
		let cap = 0;
		let done = false;

		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(idle);
			clearTimeout(cap);
			box.removeEventListener("scrollend", finish);
			box.removeEventListener("scroll", onScroll);
			resolve(true);
		};

    const onScroll = () => {
			clearTimeout(idle);
			idle = setTimeout(finish, 120);
		};

		if (behavior === "smooth") {
			if ("onscrollend" in window) {
				box.addEventListener("scrollend", finish);
			} else {
				box.addEventListener("scroll", onScroll, { passive: true });
				idle = setTimeout(finish, 120);
			}
			cap = setTimeout(finish, timeout);
			box.scrollTo({ top, behavior });
		} else {
			box.scrollTo({ top, behavior });
			finish();
		}
	});
}