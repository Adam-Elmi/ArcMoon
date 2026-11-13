export function mediaQuery(query, onChange) {
  if (typeof window === "undefined" || !window.matchMedia) {
    return { matches: false, dispose: () => {} };
  }

  const mql = window.matchMedia(query);

  const listener = (e) => {
    if (onChange) onChange(e.matches);
  };

  if (onChange) {
    mql.addEventListener("change", listener);
  }

  return {
    get matches() {
      return mql.matches;
    },
    dispose() {
      mql.removeEventListener("change", listener);
    }
  };
}