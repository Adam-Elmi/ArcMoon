export function delay(fnOrMs, ms = 300) {
  // Promise sleep mode: await delay(1500)
  if (typeof fnOrMs === "number") {
    return new Promise((resolve) => setTimeout(resolve, fnOrMs));
  }

  // Debounced function mode: delay(fn, 300)
  let timer = null;
  let lastArgs = null;

  const delayed = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fnOrMs(...lastArgs);
    }, ms);
  };

  delayed.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  delayed.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fnOrMs(...lastArgs);
    }
  };

  return delayed;
}