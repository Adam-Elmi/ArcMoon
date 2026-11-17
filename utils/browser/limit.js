// ###################
// limit(fn, ms = 300, options?) -> throttled function
// options: { leading = true, trailing = true }
// ###################
export function limit(fn, ms = 300, options = {}) {
	if (typeof fn !== "function") {
		throw new TypeError(`limit expected a function, got ${typeof fn}`);
	}

	const { leading = true, trailing = true } = options;
	let timer = null;
	let lastArgs = null;
	let lastThis = null;
	let lastCallTime = 0;

	const invoke = (time) => {
		lastCallTime = leading ? time : 0;
		timer = null;
		const args = lastArgs;
		const context = lastThis;
		lastArgs = null;
		lastThis = null;
		fn.apply(context, args);
	};

	const limited = function (...args) {
		const now = Date.now();
		if (!lastCallTime && !leading) {
			lastCallTime = now;
		}
		const remaining = ms - (now - lastCallTime);
		lastArgs = args;
		lastThis = this;

		if (remaining <= 0 || remaining > ms) {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			lastCallTime = now;
			const a = lastArgs;
			const c = lastThis;
			lastArgs = null;
			lastThis = null;
			fn.apply(c, a);
		} else if (!timer && trailing) {
			timer = setTimeout(() => {
				invoke(Date.now());
			}, remaining);
		}
	};

	limited.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		lastCallTime = 0;
		lastArgs = null;
		lastThis = null;
	};

	limited.flush = () => {
		if (timer && lastArgs) {
			clearTimeout(timer);
			invoke(Date.now());
		}
	};

	return limited;
}
