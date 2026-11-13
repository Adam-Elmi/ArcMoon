export function onKey(combo, handler, options = {}) {
  const { target = document, ignoreInputs = combo !== "Escape", prevent = false } = options;
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop();
  const needsMod = parts.includes("mod");
  const needsCtrl = parts.includes("ctrl");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");

  const listener = (e) => {
    if (ignoreInputs && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
    if (needsMod && !(e.metaKey || e.ctrlKey)) return;
    if (needsCtrl && !e.ctrlKey) return;
    if (needsShift && !e.shiftKey) return;
    if (needsAlt && !e.altKey) return;
    if (e.key.toLowerCase() !== key) return;

    if (prevent) e.preventDefault();
    handler(e);
  };

  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}