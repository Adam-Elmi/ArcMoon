const resolveEl = (target) => {
  if (!target) return null;
  if (target instanceof Node) return target;
  return target.current ?? target.el ?? (typeof target === "function" ? target() : null);
};

export function onVisible(target, handler, options = {}) {
  const { once = true, threshold = 0.1, rootMargin = "0px" } = options;
  const el = resolveEl(target);
  if (!el) return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          handler(entry);
          if (once) observer.disconnect();
        }
      }
    },
    { threshold, rootMargin }
  );

  observer.observe(el);
  return () => observer.disconnect();
}