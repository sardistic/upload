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

  applyTheme(storedTheme());

  document.addEventListener("DOMContentLoaded", () => {
    updateControls(root.dataset.theme);
    for (const control of document.querySelectorAll(".theme-toggle")) {
      control.addEventListener("click", () => {
        applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
      });
    }
  });
})();
