/**
 * ui.js
 * ---------------------------------------------------------------------
 * Small, dependency-free rendering helpers shared across screens:
 * HTML escaping, SVG progress rings, toasts and a confirm dialog.
 * These are pure DOM/string helpers - no storage or quiz logic here.
 * ---------------------------------------------------------------------
 */

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build an SVG ring string. `size` in px, `pct` 0-100. */
export function ringSvg(pct, size = 74, stroke = 8, color = "var(--primary)") {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-sunken)" stroke-width="${stroke}" />
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}" />
    </svg>`;
}

export function barHtml(pct, variant = "") {
  const cls = variant ? ` ${variant}` : "";
  return `<div class="bar-track"><div class="bar-fill${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

export function letterFor(index) {
  return String.fromCharCode(65 + index);
}

export function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

/**
 * Show a confirm dialog. Resolves true/false depending on the button pressed.
 * `okLabel` styling defaults to danger red; pass `okVariant: 'ok'` for a
 * non-destructive confirm (e.g. importing data).
 */
export function confirmDialog({ title, message, okLabel = "Confirm", cancelLabel = "Cancel", okVariant = "" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h3 id="dlg-title">${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="btn-row">
          <button class="cancel" type="button">${escapeHtml(cancelLabel)}</button>
          <button class="confirm ${okVariant}" type="button">${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector(".cancel").addEventListener("click", () => cleanup(false));
    overlay.querySelector(".confirm").addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

export function formatDateGroup(isoString) {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatTime(ms) {
  if (!ms || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
