export function onResize(target, callback) {
  if (typeof ResizeObserver === "undefined") return () => {};

  const el = typeof target === "function" ? target() : target?.current ?? target;
  if (!el) return () => {};

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) {
      const { width, height } = entry.contentRect;
      callback({ width, height, entry });
    }
  });

  observer.observe(el);
  return () => observer.disconnect();
}