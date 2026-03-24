const IDLE_DEBUG_PILL_ID = "rdm-idle-debug-pill";
const IDLE_DEBUG_POLL_MS = 1200;

function ensureIdleDebugPill() {
  let el = document.getElementById(IDLE_DEBUG_PILL_ID);
  if (el) return el;

  el = document.createElement("div");
  el.id = IDLE_DEBUG_PILL_ID;
  Object.assign(el.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    zIndex: "2147483647",
    background: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.2px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    opacity: "0.92",
    pointerEvents: "none"
  });
  el.textContent = "TRACK: ...";

  const mount = () => {
    const host = document.body || document.documentElement;
    if (!host) {
      requestAnimationFrame(mount);
      return;
    }
    if (!document.getElementById(IDLE_DEBUG_PILL_ID)) {
      host.appendChild(el);
    }
  };

  mount();
  return el;
}

function setIdleDebugPill(stateText, reasonText) {
  const el = ensureIdleDebugPill();
  el.textContent = `TRACK: ${stateText} (${reasonText})`;

  if (stateText === "IDLE") {
    el.style.background = "#7f1d1d";
    el.style.borderColor = "#ef4444";
    el.style.color = "#fee2e2";
  } else if (stateText === "ERR") {
    el.style.background = "#78350f";
    el.style.borderColor = "#f59e0b";
    el.style.color = "#fef3c7";
  } else {
    el.style.background = "#0f172a";
    el.style.borderColor = "#334155";
    el.style.color = "#e2e8f0";
  }
}

function startIdleDebugPill() {
  ensureIdleDebugPill();

  const poll = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRuntimeDebugState" });
      const systemState = String(res?.systemIdleState || "active");
      const isIdle = !!res?.isIdle;
      const reason = String(res?.idleReason || (isIdle ? systemState : "active"));
      setIdleDebugPill(isIdle ? "IDLE" : "ACTIVE", reason);
    } catch (error) {
      setIdleDebugPill("ERR", "no-bg");
    }
  };

  poll();
  setInterval(poll, IDLE_DEBUG_POLL_MS);
}

startIdleDebugPill();
