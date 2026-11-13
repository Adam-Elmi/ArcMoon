export function lockScroll(locked = true) {
  if (typeof document === "undefined") return () => {};

  const body = document.body;
  const docEl = document.documentElement;

  if (!locked) {
    body.style.overflow = "";
    body.style.paddingRight = "";
    return () => {};
  }

  const prevOverflow = body.style.overflow;
  const prevPadding = body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - docEl.clientWidth;

  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }

  // Returns an unlock function
  return () => {
    body.style.overflow = prevOverflow;
    body.style.paddingRight = prevPadding;
  };
}