let locks = 0;

export function lockPageScroll() {
  locks += 1;
  document.documentElement.dataset.scrollLocked = "";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (!locks) delete document.documentElement.dataset.scrollLocked;
  };
}
