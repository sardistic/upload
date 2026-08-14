(() => {
  const storageKey = "upload-sardistic-theme";
  const root = document.documentElement;

  function storedTheme() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function updateControls(theme) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    for (const control of document.querySelectorAll(".theme-toggle")) {
      const label = `Switch to ${nextTheme} mode`;
      control.setAttribute("aria-label", label);
      control.setAttribute("title", label);
    }
  }

  function applyTheme(theme, persist = false) {
    const safeTheme = theme === "light" ? "light" : "dark";
    root.dataset.theme = safeTheme;
    root.style.colorScheme = safeTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      safeTheme === "dark" ? "#0d0e12" : "#f2eee6",
    );
    updateControls(safeTheme);
    if (persist) {
      try {
        window.localStorage.setItem(storageKey, safeTheme);
      } catch {
        // The selected theme still applies for this page when storage is unavailable.
      }
    }
  }

  // Script injectors such as Cloudflare Rocket Loader replay DOMContentLoaded, so binding
  // must be idempotent; a control bound twice toggles twice per click and appears dead.
  function bindControls() {
    updateControls(root.dataset.theme);
    for (const control of document.querySelectorAll(".theme-toggle")) {
      if (control.dataset.themeBound === "true") continue;
      control.dataset.themeBound = "true";
      control.addEventListener("click", () => {
        applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
      });
    }
  }

  applyTheme(storedTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls);
  } else {
    bindControls();
  }
})();
