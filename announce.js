/* Site-wide admin message for Fun Games.
   Polls /api/announce and shows a big banner when there is a new message. */

(function () {
  // If device.js already started the poller, skip — still redundant on pages
  // that only load announce.js (e.g. the home page).
  if (window.__funAnnounceActive) return;
  window.__funAnnounceActive = true;

  const POLL_MS = 1500;
  const AUTO_HIDE_MS = 5000;
  const DISMISS_KEY = "funAnnounceDismissedId";
  let shownId = null;
  let banner = null;
  let hideTimer = null;

  function dismissedId() {
    try {
      return sessionStorage.getItem(DISMISS_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function rememberDismiss(id) {
    try {
      sessionStorage.setItem(DISMISS_KEY, String(id));
    } catch (e) {
      /* ignore */
    }
  }

  function clearHideTimer() {
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hideBanner() {
    clearHideTimer();
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
    banner = null;
    shownId = null;
  }

  function showBanner(message, id) {
    if (shownId === id && banner) return;
    hideBanner();
    shownId = id;

    banner = document.createElement("div");
    banner.id = "fun-announce";
    banner.setAttribute("role", "alert");
    banner.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "top:0",
      "z-index:99999",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "gap:12px",
      "flex-wrap:wrap",
      "padding:18px 16px",
      "background:#c62828",
      "color:#fff",
      "font:800 26px/1.3 system-ui,sans-serif",
      "text-align:center",
      "box-shadow:0 6px 24px rgba(0,0,0,.45)",
      "animation:funAnnouncePulse 1.2s ease-in-out infinite",
    ].join(";");

    if (!document.getElementById("fun-announce-style")) {
      const style = document.createElement("style");
      style.id = "fun-announce-style";
      style.textContent =
        "@keyframes funAnnouncePulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.25)}}";
      document.head.appendChild(style);
    }

    const text = document.createElement("span");
    text.textContent = message;
    text.style.cssText = "flex:1 1 200px;word-break:break-word;";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "OK";
    btn.setAttribute("aria-label", "Dismiss announcement");
    btn.style.cssText = [
      "flex:0 0 auto",
      "padding:10px 18px",
      "border:0",
      "border-radius:8px",
      "background:#fff",
      "color:#c62828",
      "font:700 16px system-ui,sans-serif",
      "cursor:pointer",
    ].join(";");
    btn.onclick = function () {
      rememberDismiss(id);
      hideBanner();
    };

    banner.appendChild(text);
    banner.appendChild(btn);

    function mount() {
      if (!document.body) return;
      if (!banner.parentNode) document.body.appendChild(banner);
    }
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);

    // Auto-hide after 5 seconds so the banner does not stay forever.
    hideTimer = setTimeout(function () {
      rememberDismiss(id);
      hideBanner();
    }, AUTO_HIDE_MS);
  }

  async function check() {
    try {
      const res = await fetch("/api/announce", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const message = (data && data.message) || "";
      const id = data && data.id != null ? String(data.id) : "";
      const until = data && Number(data.until);
      // Empty or past `until` means abuse/announce is over — hide and stay normal.
      if (!message || !id || (until && Date.now() > until)) {
        hideBanner();
        return;
      }
      if (dismissedId() === id) {
        if (shownId === id) hideBanner();
        return;
      }
      showBanner(message, id);
    } catch (e) {
      /* ignore — try again next poll */
    }
  }

  // First fetch right away, then keep polling so new announces show without refresh.
  check();
  setInterval(check, POLL_MS);
})();
