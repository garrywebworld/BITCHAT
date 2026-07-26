// ============================================================================
// ui.js
// Small, dependency-free UI helpers shared by login.html, register.html and
// chat.html. Nothing in here touches Firebase — it is pure DOM/formatting.
// ============================================================================

/** Shorthand for document.getElementById. */
export const $ = (id) => document.getElementById(id);

/**
 * Escapes user-supplied text before it is injected as innerHTML, preventing
 * stored/reflected HTML injection from message text, display names, etc.
 */
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/** Returns up to two initials for a display name, used for generated avatars. */
export function initialsOf(name) {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return (first + second).toUpperCase();
}

/** Formats a JS Date as a short local time, e.g. "3:45 PM". */
export function formatTime(date) {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Formats a JS Date as "Today", "Yesterday", or a short date. */
export function formatDay(date) {
  if (!date) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Formats "last seen" text from a JS Date, falling back gracefully. */
export function formatLastSeen(date) {
  if (!date) return "Offline";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Last seen just now";
  if (diffMin < 60) return `Last seen ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Last seen ${diffHr}h ago`;
  return `Last seen ${formatDay(date)} at ${formatTime(date)}`;
}

/** Converts a Firestore Timestamp (or plain Date/number) into a JS Date. */
export function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}

/**
 * Shows a dismissible toast notification. Requires a container element with
 * id="toast-stack" to be present in the page's HTML.
 */
export function showToast(message, type = "success") {
  const stack = $("toast-stack");
  if (!stack) {
    console.warn("[ui.js] No #toast-stack element found; toast:", message);
    return;
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-dot"></span><span class="toast-msg"></span>`;
  el.querySelector(".toast-msg").textContent = message;
  stack.appendChild(el);
  window.setTimeout(() => el.remove(), 4200);
}

/** Toggles a full-page loading spinner overlay. Requires id="loading-overlay". */
export function setPageLoading(isLoading) {
  const overlay = $("loading-overlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !isLoading);
}

/** Toggles a small inline spinner + disabled state on a submit button. */
export function setButtonLoading(button, isLoading, loadingText, idleText) {
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : idleText;
}

/** Displays an inline form error banner. Requires an element reference. */
export function showFormError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.add("shake");
  window.setTimeout(() => el.classList.remove("shake"), 400);
}

/** Hides an inline form error banner. */
export function clearFormError(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

/** Debounce helper — returns a function that delays invoking fn until wait ms of silence. */
export function debounce(fn, wait) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), wait);
  };
}
