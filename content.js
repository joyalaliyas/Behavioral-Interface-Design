const DEFAULTS = {
  hideLikes: true,
  hideComments: true,
  hideRecommendations: true,
  blurThumbnails: true,
  doomEnabled: true,
  doomCooldownSeconds: 30,
  doomWarningScore: 65,
  doomTriggerScore: 96
};

const STYLE_ID = "rdm-style";
const IDLE_DEBUG_PILL_ID = "rdm-idle-debug-pill";
const YT_SHIFT_DEBUG_ID = "rdm-youtube-shift-debug";
const SHORTS_BLOCK_OVERLAY_ID = "rdm-shorts-block-overlay";
const SHORTS_DEBUG_PILL_ID = "rdm-shorts-debug-pill";

function runtimeSendMessage(message) {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
      return Promise.resolve(null);
    }
    return chrome.runtime.sendMessage(message).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

const DOOM = {
  sampleMs: 500,
  cooldownMs: 30 * 1000,
  warningScore: 50,
  triggerScore: 90,
  decayPerTick: 1,
  maxScore: 100
};

const state = {
  lastY: window.scrollY,
  lastTs: Date.now(),
  score: 0,
  inCooldownUntil: 0,
  continuousHighVelocityMs: 0,
  domAddsInWindow: 0,
  warned: false,
  tickTimer: null,
  domObserver: null,
  shortActivity: 0,
  lastUserIntentTs: 0,
  swipeEvents: [],
  currentGesture: null,
  triggerStreak: 0,
  youtubeShift: {
    lastVideoId: "",
    lastVideoSignature: "",
    emitTimer: null,
    emitRetries: 0,
    overlayTimer: null,
    playbackTimer: null,
    watchPollTimer: null
  },
  shortsGuard: {
    inSession: false,
    tickTimer: null,
    currentShortId: "",
    accumulatedMs: 0
  },
  doomConfig: {
    enabled: true,
    cooldownMs: 30 * 1000,
    warningScore: 65,
    triggerScore: 96
  }
};

function normalizeDoomConfig(settings) {
  const cooldown = Number(settings.doomCooldownSeconds);
  const warning = Number(settings.doomWarningScore);
  const trigger = Number(settings.doomTriggerScore);

  const out = {
    enabled: settings.doomEnabled !== false,
    cooldownMs: Number.isFinite(cooldown)
      ? Math.max(10, Math.min(180, Math.round(cooldown))) * 1000
      : DOOM.cooldownMs,
    warningScore: Number.isFinite(warning)
      ? Math.max(30, Math.min(90, Math.round(warning)))
      : DOOM.warningScore,
    triggerScore: Number.isFinite(trigger)
      ? Math.max(40, Math.min(100, Math.round(trigger)))
      : DOOM.triggerScore
  };

  if (out.triggerScore <= out.warningScore) {
    out.triggerScore = Math.min(100, out.warningScore + 8);
  }

  return out;
}

function buildCss(s) {
  const rules = [];

  if (s.hideLikes) {
    rules.push(
      "ytd-menu-renderer ytd-toggle-button-renderer:first-child," +
      "#segmented-like-button," +
      "ytd-video-primary-info-renderer #top-level-buttons-computed {" +
      "display: none !important;" +
      "}"
    );
  }

  if (s.hideComments) {
    rules.push(
      "ytd-comments," +
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-comments-section'] {" +
      "display: none !important;" +
      "}"
    );
  }

 if (s.hideRecommendations) {
  rules.push(
    "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer," +
    "ytd-browse[page-subtype='home'] #contents.ytd-rich-grid-renderer," +
    "ytd-browse[page-subtype='home'] ytd-rich-item-renderer," +
    "ytd-browse[page-subtype='home'] ytd-rich-section-renderer," +
    "ytd-browse[page-subtype='home'] ytd-reel-shelf-renderer," +
    "ytd-watch-next-secondary-results-renderer {" +
    "display: none !important;" +
    "}"
  );
}

if (s.blurThumbnails) {
  rules.push(
    "ytd-browse[page-subtype='home'] ytd-thumbnail img," +
    "ytd-browse[page-subtype='home'] yt-image img," +
    "ytd-browse[page-subtype='home'] img.yt-core-image," +
    "ytd-browse[page-subtype='search'] ytd-thumbnail img," +
    "ytd-browse[page-subtype='search'] yt-image img," +
    "ytd-browse[page-subtype='search'] img.yt-core-image," +
    "ytd-browse[page-subtype='playlist'] ytd-thumbnail img," +
    "ytd-browse[page-subtype='playlist'] yt-image img," +
    "ytd-browse[page-subtype='playlist'] img.yt-core-image," +
    "ytd-playlist-video-renderer #thumbnail img," +
    "ytd-playlist-video-renderer ytd-thumbnail img," +
    "ytd-playlist-video-renderer .ytThumbnailViewModelImage img," +
    "ytd-compact-playlist-renderer #thumbnail img," +
    "ytd-compact-playlist-renderer .ytThumbnailViewModelImage img," +
    "ytd-compact-video-renderer #thumbnail img," +
    "ytd-compact-video-renderer .ytThumbnailViewModelImage img," +
    "ytd-watch-next-secondary-results-renderer ytd-thumbnail img," +
    "ytd-watch-next-secondary-results-renderer #thumbnail img," +
    "ytd-watch-next-secondary-results-renderer .ytThumbnailViewModelImage img," +
    "ytd-rich-grid-media #thumbnail img," +
    "ytd-rich-grid-media .ytThumbnailViewModelImage img," +
    "ytd-video-renderer #thumbnail img," +
    "ytd-video-renderer .ytThumbnailViewModelImage img," +
    "ytd-playlist-renderer #thumbnail img," +
    "ytd-playlist-renderer .ytThumbnailViewModelImage img," +
    "ytd-rich-item-renderer #thumbnail img," +
    "ytd-rich-item-renderer .ytThumbnailViewModelImage img," +
    "yt-thumbnail-view-model img.ytCoreImageHost," +
    "img[aria-label*='thumbnail'][src*='i.ytimg.com']," +
    "img[aria-label*='Thumbnail'][src*='i.ytimg.com'] {" +
    "filter: blur(10px) !important;" +
    "transform: scale(1.03);" +
    "}"
  );
}

  return rules.join("\n");
}

function applyStyles(settings) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = buildCss(settings);
  state.doomConfig = normalizeDoomConfig(settings);
}

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
    if (!document.body) {
      requestAnimationFrame(mount);
      return;
    }
    if (!document.getElementById(IDLE_DEBUG_PILL_ID)) {
      document.body.appendChild(el);
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
      const res = await runtimeSendMessage({ type: "getRuntimeDebugState" });
      const isIdle = !!res?.isIdle;
      const reason = String(res?.idleReason || (isIdle ? "idle" : "active"));
      setIdleDebugPill(isIdle ? "IDLE" : "ACTIVE", reason);
    } catch (error) {
      setIdleDebugPill("ERR", "no-bg");
    }
  };

  poll();
  setInterval(poll, 1200);
}

function formatShortsTimer(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function ensureShortsDebugPill() {
  let el = document.getElementById(SHORTS_DEBUG_PILL_ID);
  if (el) return el;

  el = document.createElement("div");
  el.id = SHORTS_DEBUG_PILL_ID;
  Object.assign(el.style, {
    position: "fixed",
    top: "44px",
    right: "10px",
    zIndex: "2147483647",
    background: "#111827",
    color: "#e5e7eb",
    border: "1px solid #374151",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.2px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    opacity: "0.95",
    pointerEvents: "none"
  });
  el.textContent = "SHORTS 00:00";

  const mount = () => {
    if (!document.body) {
      requestAnimationFrame(mount);
      return;
    }
    if (!document.getElementById(SHORTS_DEBUG_PILL_ID)) {
      document.body.appendChild(el);
    }
  };

  mount();
  return el;
}

function setShortsDebugPill(accumulatedMs, isActive) {
  const el = ensureShortsDebugPill();
  const timerText = formatShortsTimer(accumulatedMs);
  const stateText = isActive ? "LIVE" : "PAUSED";
  el.textContent = `SHORTS ${timerText} (${stateText})`;

  if (isActive) {
    el.style.background = "#111827";
    el.style.borderColor = "#374151";
    el.style.color = "#e5e7eb";
  } else {
    el.style.background = "#1f2937";
    el.style.borderColor = "#6b7280";
    el.style.color = "#d1d5db";
  }
}

function clearShortsDebugPill() {
  const el = document.getElementById(SHORTS_DEBUG_PILL_ID);
  if (el) {
    el.remove();
  }
}

function startDomGrowthTracker() {
  if (state.domObserver) return;

  state.domObserver = new MutationObserver((mutations) => {
    let adds = 0;
    for (const m of mutations) {
      adds += m.addedNodes ? m.addedNodes.length : 0;
    }
    state.domAddsInWindow += adds;
  });

  state.domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function installIntentSignals() {
  window.addEventListener(
    "wheel",
    () => {
      state.shortActivity += 1;
      state.lastUserIntentTs = Date.now();
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    () => {
      state.shortActivity += 1;
      state.lastUserIntentTs = Date.now();
    },
    { passive: true }
  );

  window.addEventListener("keydown", (e) => {
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "PageDown" ||
      e.key === "PageUp" ||
      e.key === " "
    ) {
      state.shortActivity += 1;
      state.lastUserIntentTs = Date.now();
    }
  });
}

function installSwipeGestureSignals() {
  window.addEventListener(
    "pointerdown",
    (e) => {
      state.currentGesture = {
        startY: e.clientY,
        startTs: Date.now(),
        samples: [{ y: e.clientY, ts: Date.now() }]
      };
    },
    { passive: true }
  );

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!state.currentGesture) return;
      state.currentGesture.samples.push({ y: e.clientY, ts: Date.now() });
    },
    { passive: true }
  );

  window.addEventListener(
    "pointerup",
    () => {
      if (!state.currentGesture) return;

      const gesture = state.currentGesture;
      state.currentGesture = null;

      const end = gesture.samples[gesture.samples.length - 1];
      const totalSamples = gesture.samples.length;
      const dy = Math.abs(end.y - gesture.startY);
      const dt = Math.max(1, end.ts - gesture.startTs);
      const velocity = dy / dt; // px/ms

      const isSwipe = totalSamples >= 3 && dy >= 120 && velocity >= 0.5;
      if (isSwipe) {
        state.swipeEvents.push(Date.now());
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "pointercancel",
    () => {
      state.currentGesture = null;
    },
    { passive: true }
  );
}

function getRecentSwipeCount(windowMs) {
  const now = Date.now();
  state.swipeEvents = state.swipeEvents.filter((ts) => now - ts <= windowMs);
  return state.swipeEvents.length;
}

function contextWeight() {
  const path = location.pathname;
  if (path.startsWith("/shorts")) return 1.5;
  if (path === "/results") return 0.6;
  if (path === "/") return 1.2;
  if (path === "/watch") return 0.8;
  return 1.0;
}

function showWarning() {
  if (document.getElementById("rdm-warning")) return;

  const el = document.createElement("div");
  el.id = "rdm-warning";
  el.textContent = "You have been scrolling continuously.";
  Object.assign(el.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    background: "#111",
    color: "#fff",
    padding: "10px 12px",
    borderRadius: "10px",
    fontSize: "12px",
    opacity: "0.95"
  });

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function onDoomscrollDetected(cooldownMs) {
  const existingOverlay = document.getElementById("rdm-doom-overlay");
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "rdm-doom-overlay";
  
  const duration = Math.max(10 * 1000, cooldownMs || 30 * 1000);
  const startTime = Date.now();
  
  const updateTimer = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
    timerEl.textContent = `${remaining}s`;
    
    if (remaining > 0) {
      requestAnimationFrame(updateTimer);
    } else {
      overlay.remove();
    }
  };

  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    zIndex: "2147483647",
    background: "#ff0000",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto"
  });

  const timerEl = document.createElement("div");
  Object.assign(timerEl.style, {
    fontSize: "120px",
    fontWeight: "900",
    color: "#fff",
    textShadow: "0 0 20px rgba(0,0,0,0.5)"
  });

  const textEl = document.createElement("div");
  textEl.textContent = "TAKE A BREAK";
  Object.assign(textEl.style, {
    fontSize: "36px",
    fontWeight: "700",
    color: "#fff",
    marginBottom: "20px",
    textShadow: "0 0 20px rgba(0,0,0,0.5)"
  });

  overlay.appendChild(textEl);
  overlay.appendChild(timerEl);
  document.body.appendChild(overlay);

  updateTimer();

  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.remove();
    }
  }, duration);
}

function clearYouTubeShiftOverlay() {
  const existing = document.getElementById("rdm-youtube-shift-overlay");
  if (existing) {
    existing.remove();
  }
  if (state.youtubeShift.overlayTimer) {
    clearInterval(state.youtubeShift.overlayTimer);
    state.youtubeShift.overlayTimer = null;
  }
}

function ensureYouTubeShiftDebugPanel() {
  let el = document.getElementById(YT_SHIFT_DEBUG_ID);
  if (el) return el;

  el = document.createElement("div");
  el.id = YT_SHIFT_DEBUG_ID;
  Object.assign(el.style, {
    position: "fixed",
    left: "10px",
    bottom: "10px",
    zIndex: "2147483647",
    background: "rgba(15, 23, 42, 0.94)",
    border: "1px solid #334155",
    color: "#e2e8f0",
    borderRadius: "10px",
    padding: "8px 10px",
    fontSize: "11px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    lineHeight: "1.5",
    maxWidth: "340px",
    pointerEvents: "none"
  });
  el.textContent = "YT SHIFT DEBUG: waiting...";

  const mount = () => {
    const host = document.body || document.documentElement;
    if (!host) {
      requestAnimationFrame(mount);
      return;
    }
    if (!document.getElementById(YT_SHIFT_DEBUG_ID)) {
      host.appendChild(el);
    }
  };

  mount();
  return el;
}

function updateYouTubeShiftDebugPanel(payload) {
  const el = ensureYouTubeShiftDebugPanel();
  const previousLabel = String(payload?.previousLabel || "n/a");
  const currentLabel = String(payload?.currentLabel || "n/a");
  const pairMatched = payload?.monitoredPairMatch ? "yes" : "no";
  const severity = String(payload?.finalSeverity || "none");
  const decision = String(payload?.finalDecision || "not-evaluated");

  el.textContent = [
    `previous label: ${previousLabel}`,
    `current label: ${currentLabel}`,
    `monitored pair match: ${pairMatched}`,
    `final severity/decision: ${severity} / ${decision}`
  ].join("\n");
}

function renderYouTubeShiftWarning(message) {
  clearYouTubeShiftOverlay();

  const durationSeconds = Math.max(2, Number(message?.seconds || 5));
  const overlay = document.createElement("div");
  overlay.id = "rdm-youtube-shift-overlay";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "rgba(6, 8, 14, 0.8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px"
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(640px, 92vw)",
    background: "#121a28",
    border: "1px solid #334155",
    borderRadius: "16px",
    color: "#e5e7eb",
    padding: "20px"
  });

  const title = document.createElement("div");
  title.textContent = "Focus check: possible distraction";
  Object.assign(title.style, {
    fontSize: "20px",
    fontWeight: "700",
    marginBottom: "8px"
  });

  const reason = document.createElement("div");
  reason.textContent = message?.reason || "This video looks outside your current study flow.";
  Object.assign(reason.style, {
    fontSize: "14px",
    color: "#cbd5e1",
    marginBottom: "14px"
  });

  const countdown = document.createElement("div");
  countdown.textContent = `${durationSeconds}s until temporary block`;
  Object.assign(countdown.style, {
    fontSize: "32px",
    fontWeight: "800",
    marginBottom: "16px"
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap"
  });

  const allowBtn = document.createElement("button");
  allowBtn.textContent = "Allow once (cooldown)";
  Object.assign(allowBtn.style, {
    border: "1px solid #22c55e",
    background: "#166534",
    color: "#ecfdf5",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer"
  });
  allowBtn.addEventListener("click", async () => {
    await runtimeSendMessage({ type: "youtubeShiftAllowOnce" });
    clearYouTubeShiftOverlay();
  });

  const keepFocusBtn = document.createElement("button");
  keepFocusBtn.textContent = "Go back to focused content";
  Object.assign(keepFocusBtn.style, {
    border: "1px solid #475569",
    background: "#1e293b",
    color: "#e2e8f0",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer"
  });
  keepFocusBtn.addEventListener("click", () => {
    history.back();
  });

  actions.appendChild(allowBtn);
  actions.appendChild(keepFocusBtn);

  card.appendChild(title);
  card.appendChild(reason);
  card.appendChild(countdown);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let remaining = durationSeconds;
  state.youtubeShift.overlayTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(state.youtubeShift.overlayTimer);
      state.youtubeShift.overlayTimer = null;
      return;
    }
    countdown.textContent = `${remaining}s until temporary block`;
  }, 1000);
}

function renderYouTubeShiftBlock(message) {
  clearYouTubeShiftOverlay();

  const overlay = document.createElement("div");
  overlay.id = "rdm-youtube-shift-overlay";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "#05070b",
    color: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "20px"
  });

  const h = document.createElement("div");
  h.textContent = "Blocked for focus";
  Object.assign(h.style, {
    fontSize: "44px",
    fontWeight: "900",
    marginBottom: "10px"
  });

  const reason = document.createElement("div");
  reason.textContent = message?.reason || "This jump looks distracting right now.";
  Object.assign(reason.style, {
    fontSize: "16px",
    color: "#cbd5e1",
    marginBottom: "18px",
    maxWidth: "720px"
  });

  const sub = document.createElement("div");
  sub.textContent = "This screen is locked until you choose a focus action.";
  Object.assign(sub.style, {
    fontSize: "14px",
    color: "#94a3b8",
    marginBottom: "18px"
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    justifyContent: "center"
  });

  const goBackBtn = document.createElement("button");
  goBackBtn.textContent = "Go back";
  Object.assign(goBackBtn.style, {
    border: "1px solid #475569",
    background: "#0f172a",
    color: "#e2e8f0",
    borderRadius: "10px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: "700"
  });
  goBackBtn.addEventListener("click", () => {
    const previousUrl = String(message?.previousUrl || "").trim();
    if (previousUrl) {
      window.location.href = previousUrl;
      return;
    }
    history.back();
  });

  overlay.appendChild(h);
  overlay.appendChild(reason);
  overlay.appendChild(sub);
  actions.appendChild(goBackBtn);
  overlay.appendChild(actions);
  document.body.appendChild(overlay);
}

function clearShortsBlockOverlay() {
  const existing = document.getElementById(SHORTS_BLOCK_OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
}

function renderShortsBlockOverlay(message = {}) {
  clearShortsBlockOverlay();

  const overlay = document.createElement("div");
  overlay.id = SHORTS_BLOCK_OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "#05070b",
    color: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "20px"
  });

  const h = document.createElement("div");
  const isDailyLocked = !!message?.blockedToday;
  const isNoUsageLimit = !!message?.noUsageLimit;
  h.textContent = isNoUsageLimit
    ? "Shorts disabled"
    : (isDailyLocked ? "Shorts blocked for today" : "Shorts limit reached");
  Object.assign(h.style, {
    fontSize: "44px",
    fontWeight: "900",
    marginBottom: "10px"
  });

  const reason = document.createElement("div");
  const thresholdSeconds = Math.max(0, Number(message?.thresholdSeconds || 60));
  const thresholdLabel = thresholdSeconds % 60 === 0
    ? `${Math.round(thresholdSeconds / 60)} minute${thresholdSeconds === 60 ? "" : "s"}`
    : `${thresholdSeconds} seconds`;
  reason.textContent = isNoUsageLimit
    ? "Shorts usage is disabled in settings (0 minutes). Increase the Shorts timer to enable access."
    : (isDailyLocked
      ? `You hit your ${thresholdLabel} Shorts limit for today. Shorts unlock at your next local midnight.`
      : `You spent more than ${thresholdLabel} in Shorts. Let's get back to focus.`);
  Object.assign(reason.style, {
    fontSize: "16px",
    color: "#cbd5e1",
    marginBottom: "18px",
    maxWidth: "720px"
  });

  const goBackBtn = document.createElement("button");
  goBackBtn.textContent = "Go back";
  Object.assign(goBackBtn.style, {
    border: "1px solid #475569",
    background: "#0f172a",
    color: "#e2e8f0",
    borderRadius: "10px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: "700"
  });
  goBackBtn.addEventListener("click", () => {
    window.location.href = "https://www.youtube.com/";
  });

  overlay.appendChild(h);
  overlay.appendChild(reason);
  overlay.appendChild(goBackBtn);
  document.body.appendChild(overlay);
}

function isShortsRoute() {
  return location.pathname.startsWith("/shorts");
}

function getShortIdFromPathname() {
  if (!isShortsRoute()) return "";
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return String(parts[1] || "").trim();
}

function getCurrentShortId() {
  if (!isShortsRoute()) return "";

  const activeReel = document.querySelector(
    "ytd-reel-video-renderer[is-active], ytd-reel-video-renderer[aria-hidden='false'], ytd-reel-video-renderer[is-active='true']"
  );

  const domId = String(
    activeReel?.getAttribute("data-reel-item-id")
      || activeReel?.getAttribute("video-id")
      || activeReel?.id
      || ""
  ).trim();

  return domId || getShortIdFromPathname();
}

function getShortsVideoElement() {
  if (!isShortsRoute()) return null;

  // Prefer Shorts-specific player first for better reliability on YouTube SPA pages.
  return document.querySelector("#shorts-player > div > video")
    || document.querySelector("#shorts-player video")
    || document.querySelector("ytd-reel-video-renderer[is-active] video")
    || document.querySelector("video");
}

function isShortsActiveForeground() {
  if (!isShortsRoute()) return false;
  if (document.visibilityState !== "visible") return false;
  const media = getShortsVideoElement();
  if (!media) return false;
  return !media.paused && !media.ended;
}

async function sendShortsTick() {
  const shortId = getCurrentShortId();
  if (shortId) {
    state.shortsGuard.currentShortId = shortId;
  }
  const isActive = isShortsActiveForeground();
  const res = await runtimeSendMessage({
    type: "shortsSessionTick",
    active: isActive,
    shortId: shortId || state.shortsGuard.currentShortId || ""
  });

  const accumulatedMs = Number(res?.accumulatedMs);
  if (Number.isFinite(accumulatedMs)) {
    state.shortsGuard.accumulatedMs = Math.max(0, accumulatedMs);
  }

  if (res?.blocked && isShortsRoute()) {
    renderShortsBlockOverlay({
      thresholdSeconds: Number(res?.thresholdSeconds || 60),
      blockedToday: !!res?.blockedToday,
      noUsageLimit: !!res?.noUsageLimit
    });
  }

  if (isShortsRoute()) {
    setShortsDebugPill(state.shortsGuard.accumulatedMs, isActive);
  }
}

async function startShortsSessionTracking() {
  if (state.shortsGuard.inSession) return;

  state.shortsGuard.currentShortId = getCurrentShortId();
  const res = await runtimeSendMessage({
    type: "shortsSessionStart",
    shortId: state.shortsGuard.currentShortId
  });

  if (res?.blocked || res?.blockedToday || res?.noUsageLimit) {
    state.shortsGuard.inSession = false;
    state.shortsGuard.accumulatedMs = Math.max(0, Number(res?.accumulatedMs || 0));
    setShortsDebugPill(state.shortsGuard.accumulatedMs, false);
    renderShortsBlockOverlay({
      thresholdSeconds: Number(res?.thresholdSeconds || 60),
      blockedToday: !!res?.blockedToday,
      noUsageLimit: !!res?.noUsageLimit
    });
    return;
  }

  state.shortsGuard.inSession = true;
  state.shortsGuard.accumulatedMs = 0;
  setShortsDebugPill(0, isShortsActiveForeground());
  sendShortsTick();

  if (!state.shortsGuard.tickTimer) {
    state.shortsGuard.tickTimer = setInterval(sendShortsTick, 2000);
  }
}

function stopShortsSessionTracking() {
  if (!state.shortsGuard.inSession && !state.shortsGuard.tickTimer) return;

  state.shortsGuard.inSession = false;
  state.shortsGuard.currentShortId = "";
  state.shortsGuard.accumulatedMs = 0;
  if (state.shortsGuard.tickTimer) {
    clearInterval(state.shortsGuard.tickTimer);
    state.shortsGuard.tickTimer = null;
  }

  runtimeSendMessage({ type: "shortsSessionEnd" });
  clearShortsBlockOverlay();
  clearShortsDebugPill();
}

function updateShortsSessionTracking() {
  if (isShortsRoute()) {
    void startShortsSessionTracking();
  } else {
    stopShortsSessionTracking();
  }
}

function startShortsSessionWatcher() {
  const handler = () => {
    setTimeout(updateShortsSessionTracking, 120);
  };

  document.addEventListener("yt-navigate-finish", handler);
  document.addEventListener("yt-page-data-updated", handler);
  window.addEventListener("popstate", handler);
  document.addEventListener("visibilitychange", sendShortsTick);

  const mediaEvents = ["play", "pause", "ended", "seeking", "seeked"];
  mediaEvents.forEach((eventName) => {
    document.addEventListener(eventName, sendShortsTick, true);
  });

  updateShortsSessionTracking();
}

function getCurrentWatchVideoInfo() {
  if (location.pathname !== "/watch") return null;
  const videoId = new URL(location.href).searchParams.get("v");
  if (!videoId) return null;

  const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string");
  const rawTitle = titleEl?.textContent || document.title;
  const title = String(rawTitle || "").replace(/\s*-\s*YouTube\s*$/i, "").trim();
  if (!title) return null;

  const channelEl = document.querySelector(
    "ytd-watch-metadata #channel-name a, ytd-watch-metadata #owner-name a, ytd-video-owner-renderer #channel-name a"
  );
  const channelName = String(channelEl?.textContent || "").trim();

  return {
    videoId,
    title,
    channelName,
    url: location.href
  };
}

function emitYouTubeVideoChanged() {
  const info = getCurrentWatchVideoInfo();
  if (!info) {
    if (state.youtubeShift.emitRetries < 10) {
      state.youtubeShift.emitRetries += 1;
      scheduleYouTubeVideoChangedEmit(350);
    }
    return;
  }

  state.youtubeShift.emitRetries = 0;
  const signature = `${info.videoId}|${info.title.toLowerCase()}`;
  if (state.youtubeShift.lastVideoSignature === signature) return;

  state.youtubeShift.lastVideoId = info.videoId;
  state.youtubeShift.lastVideoSignature = signature;
  runtimeSendMessage({ type: "youtubeVideoChanged", ...info });
}

function scheduleYouTubeVideoChangedEmit(delayMs = 700) {
  if (state.youtubeShift.emitTimer) {
    clearTimeout(state.youtubeShift.emitTimer);
  }
  state.youtubeShift.emitTimer = setTimeout(() => {
    emitYouTubeVideoChanged();
  }, delayMs);
}

function startYouTubeShiftWatcher() {
  const handler = () => scheduleYouTubeVideoChangedEmit(800);
  document.addEventListener("yt-navigate-finish", handler);
  document.addEventListener("yt-page-data-updated", handler);
  window.addEventListener("popstate", handler);
  if (!state.youtubeShift.watchPollTimer) {
    state.youtubeShift.watchPollTimer = setInterval(() => {
      if (location.pathname === "/watch") {
        emitYouTubeVideoChanged();
      }
    }, 2000);
  }
  scheduleYouTubeVideoChangedEmit(900);
}

function isYouTubeWatchPlaybackActive() {
  if (location.pathname !== "/watch") return false;
  if (document.visibilityState !== "visible") return false;

  const media = document.querySelector("video");
  if (!media) return false;
  if (media.paused || media.ended) return false;
  if (media.readyState < 2) return false;
  return true;
}

function emitYouTubePlaybackSignal() {
  const isPlaying = isYouTubeWatchPlaybackActive();
  runtimeSendMessage({ type: "youtubePlaybackSignal", isPlaying });
}

function startYouTubePlaybackSignal() {
  if (state.youtubeShift.playbackTimer) return;

  const tick = () => emitYouTubePlaybackSignal();
  state.youtubeShift.playbackTimer = setInterval(tick, 8000);

  document.addEventListener("visibilitychange", tick);
  document.addEventListener("yt-navigate-finish", tick);

  const mediaEvents = ["play", "pause", "ended", "seeking", "seeked", "ratechange"];
  mediaEvents.forEach((eventName) => {
    document.addEventListener(eventName, tick, true);
  });

  tick();
}

function detectorTick() {
  const now = Date.now();
  const dt = Math.max(1, now - state.lastTs);
  const isShorts = location.pathname.startsWith("/shorts");
  let add = 0;
  const doom = state.doomConfig;

  if (!doom.enabled) {
    state.score = 0;
    state.warned = false;
    state.triggerStreak = 0;
    state.domAddsInWindow = 0;
    state.shortActivity = 0;
    state.lastTs = now;
    state.lastY = window.scrollY;
    return;
  }

  if (now < state.inCooldownUntil) {
    state.score = 0;
    state.warned = false;
    state.domAddsInWindow = 0;
    state.shortActivity = 0;
    state.triggerStreak = 0;
    state.lastTs = now;
    state.lastY = window.scrollY;
    return;
  }

  if (isShorts) {
    const swipeCount45s = getRecentSwipeCount(45 * 1000);

    if (swipeCount45s >= 18) add += 14;
    else if (swipeCount45s >= 12) add += 9;
    else if (swipeCount45s >= 7) add += 5;

    // Keep a small fallback for wheel/keyboard interactions.
    if (state.shortActivity >= 2) add += 2;
    else if (state.shortActivity >= 1) add += 1;

    if (state.domAddsInWindow > 5) add += 2;
  } else {
    const y = window.scrollY;
    const dy = Math.abs(y - state.lastY);
    const velocity = (dy / dt) * 1000;

    const highVelocity = velocity > 1200;
    const mediumVelocity = velocity > 500;

    if (highVelocity) {
      state.continuousHighVelocityMs += dt;
    } else {
      state.continuousHighVelocityMs = Math.max(
        0,
        state.continuousHighVelocityMs - dt * 1.5
      );
    }

    if (highVelocity) add += state.shortActivity <= 1 ? 5 : 2;
    else if (mediumVelocity) add += state.shortActivity <= 1 ? 2 : 1;

    if (state.continuousHighVelocityMs > 4500) add += 5;
    if (state.domAddsInWindow > 35) add += 7;
    else if (state.domAddsInWindow > 15) add += 3;

    if (location.pathname === "/results") {
      add *= 0.45;
    }

    state.lastY = y;
  }

  state.lastTs = now;
  add *= contextWeight();

  state.score = Math.min(
    DOOM.maxScore,
    Math.max(0, state.score - DOOM.decayPerTick + add)
  );

  if (!state.warned && state.score >= doom.warningScore) {
    state.warned = true;
    showWarning();
  }

  const inCooldown = now < state.inCooldownUntil;
  if (state.score >= doom.triggerScore) {
    state.triggerStreak += 1;
  } else {
    state.triggerStreak = 0;
  }

  if (!inCooldown && state.triggerStreak >= 3) {
    state.inCooldownUntil = now + doom.cooldownMs;
    state.warned = false;
    state.score = 0;
    state.triggerStreak = 0;
    onDoomscrollDetected(doom.cooldownMs);
  }

  state.domAddsInWindow = 0;
  state.shortActivity = 0;
}

function resetDetectorState() {
  state.lastY = window.scrollY;
  state.lastTs = Date.now();
  state.domAddsInWindow = 0;
  state.shortActivity = 0;
  state.swipeEvents = [];
  state.currentGesture = null;
  state.continuousHighVelocityMs = 0;
  state.triggerStreak = 0;
  state.warned = false;
}

function startDetector() {
  if (state.tickTimer) return;

  installIntentSignals();
  installSwipeGestureSignals();
  startDomGrowthTracker();
  state.tickTimer = setInterval(detectorTick, DOOM.sampleMs);

  let previousWasShorts = location.pathname.startsWith("/shorts");

  document.addEventListener("yt-navigate-finish", () => {
    const nowIsShorts = location.pathname.startsWith("/shorts");
    if (previousWasShorts && !nowIsShorts) {
      resetDetectorState();
    }
    previousWasShorts = nowIsShorts;
  });
  
  window.addEventListener("popstate", () => {
    if (!location.pathname.startsWith("/shorts")) {
      resetDetectorState();
    }
  });
}

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  applyStyles(settings);
  startIdleDebugPill();
  startDetector();
  startYouTubeShiftWatcher();
  startYouTubePlaybackSignal();
  startShortsSessionWatcher();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  chrome.storage.sync.get(DEFAULTS).then(applyStyles);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "youtubeShiftDebug") {
    updateYouTubeShiftDebugPanel(message);
    return;
  }

  if (message?.type === "shortsOverlay") {
    if (message.mode === "clear") {
      clearShortsBlockOverlay();
      return;
    }
    if (message.mode === "block") {
      renderShortsBlockOverlay(message);
      return;
    }
  }

  if (message?.type !== "youtubeShiftOverlay") return;
  if (message.mode === "clear") {
    clearYouTubeShiftOverlay();
    return;
  }
  if (message.mode === "warning") {
    renderYouTubeShiftWarning(message);
    return;
  }
  if (message.mode === "block") {
    renderYouTubeShiftBlock(message);
  }
});

init();