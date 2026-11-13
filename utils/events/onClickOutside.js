const resolveEl = (target) => {
  if (!target) return null;
  if (target instanceof Node) return target;
  // Adapt to however ArcMoon.ref stores/resolves its underlying DOM node
  return target.current ?? target.el ?? (typeof target === "function" ? target() : null);
};

export function onClickOutside(targets, handler) {
  const list = Array.isArray(targets) ? targets : [targets];

  const listener = (event) => {
    const path = event.composedPath();
    const isInside = list.some((target) => {
      const el = resolveEl(target);
      return el && (el === event.target || path.includes(el));
    });

    if (!isInside) handler(event);
  };

  document.addEventListener("pointerdown", listener);
  return () => document.removeEventListener("pointerdown", listener);
}