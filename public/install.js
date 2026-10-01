(() => {
  function initialize() {
    // The edge can replay script initialization; bind each install flow once.
    if (window.uploadInstallInitialized) return;
    window.uploadInstallInitialized = true;

    const buttons = [...document.querySelectorAll(".install-button")];
    const dialog = document.querySelector("#install-dialog");
    const description = document.querySelector("#install-description");
    const steps = document.querySelector("#install-steps");
    const confirm = document.querySelector("#install-confirm");
    const standalone = window.matchMedia("(display-mode: standalone)");
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    const minimal = window.matchMedia("(display-mode: minimal-ui)");
    let deferredPrompt = null;
    let installed = false;
    let prompting = false;

    function isInstalled() {
      return installed || standalone.matches || fullscreen.matches || minimal.matches || navigator.standalone === true;
    }

    function refresh() {
      const hidden = isInstalled();
      for (const button of buttons) {
        button.classList.toggle("hidden", hidden);
        button.disabled = prompting;
      }
      confirm.classList.toggle("hidden", hidden || !deferredPrompt);
      confirm.disabled = prompting;
      if (hidden && dialog.open) dialog.close();
    }

    function showInstructions() {
      const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const android = /Android/i.test(navigator.userAgent);
      const instructions = appleMobile ? [
        "Open this site in Safari, then tap Share (in the browser menu on some versions).",
        "Choose Add to Home Screen, turn on Open as Web App if shown, then tap Add.",
      ] : android ? [
        "Open this site in Chrome or another browser that supports app installation.",
        "Open the browser menu (⋮), scroll down, and choose Install and create shortcut → Install. Older versions call it Install app or Add to Home screen.",
      ] : [
        "In Chrome or Edge, use the install icon in the address bar or the browser menu’s install option.",
        "In Safari on Mac, choose File → Add to Dock. If your browser has no install option, open this site in Chrome or Edge.",
      ];
      description.textContent = "Add Uploads to your home screen or desktop to open it as an app.";
      steps.replaceChildren(...instructions.map((instruction) => {
        const item = document.createElement("li");
        item.textContent = instruction;
        return item;
      }));
      refresh();
      if (!isInstalled() && !dialog.open) dialog.showModal();
    }

    async function install() {
      if (isInstalled() || prompting) return;
      if (!deferredPrompt) {
        showInstructions();
        return;
      }
      const prompt = deferredPrompt;
      deferredPrompt = null; // Each browser event can only be used once.
      prompting = true;
      refresh();
      if (dialog.open) dialog.close();
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted") installed = true;
      } catch {
        showInstructions();
        description.textContent = "Use your browser’s menu to install Uploads on this device.";
      } finally {
        prompting = false;
        refresh();
      }
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;
      refresh();
    });
    window.addEventListener("appinstalled", () => {
      installed = true;
      deferredPrompt = null;
      refresh();
    });
    for (const mode of [standalone, fullscreen, minimal]) mode.addEventListener("change", refresh);
    for (const button of buttons) button.addEventListener("click", install);
    confirm.addEventListener("click", install);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Keep browser-menu instructions usable even when registration is blocked.
    });
  }
})();
