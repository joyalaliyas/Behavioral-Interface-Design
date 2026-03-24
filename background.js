// ============================================================================
// ACTIVITY TRACKER - Service Worker (Chrome Extension)
// Implements heartbeat-based time tracking inspired by ActivityWatch
// ============================================================================

// ============================================================================
// CONFIGURATION
// ============================================================================

const STORAGE_KEYS = {
  DAILY_USAGE: 'dailyUsage',
  ALERTS_SHOWN: 'alertsShown',
  DAILY_SHORTS_BLOCK: 'dailyShortsBlock',
  SETTINGS: 'settings',
  CATEGORIES: 'categories',
  LIMITS: 'limits',
  LATEST_AI_INSIGHT: 'latestAiInsight',
  YOUTUBE_TITLE_CONTEXT: 'youtubeTitleContext',
  YOUTUBE_SHIFT_HISTORY: 'youtubeShiftHistory'
};

const YOUTUBE_SHIFT_DEFAULTS = {
  enabled: true,
  aiEnabled: true,
  warnSeconds: 5,
  blockSeconds: 30,
  cooldownSeconds: 120,
  severityThreshold: 'medium',
  cacheTtlSeconds: 3600,
  monitoredPairs: [
    'Learning->Entertainment',
    'Learning->Social',
    'Productive->Entertainment',
    'Productive->Social'
  ]
};

const DEFAULT_SETTINGS = {
  categories: {
    Productive: ['github.com', 'stackoverflow.com', 'docs.google.com', 'notion.so'],
    Learning: ['coursera.org', 'udemy.com', 'khanacademy.org', 'developer.mozilla.org'],
    Entertainment: ['youtube.com', 'netflix.com', 'primevideo.com', 'twitch.tv'],
    Social: ['instagram.com', 'twitter.com', 'x.com', 'reddit.com', 'facebook.com']
  },
  categoryLimitsMinutes: {
    Entertainment: 60,
    Social: 45
  },
  domainLimitsMinutes: {
    'youtube.com': 60
  },
  alertEnabled: true,
  blockAfterLimit: false,
  shortsBlockSeconds: 60,
  aiInsights: {
    enabled: false,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4',
    apiKey: '',
    systemPrompt: 'You are a practical productivity coach. Give short, concrete, non-judgmental advice based on browsing time data.'
  },
  youtubeShiftGuard: { ...YOUTUBE_SHIFT_DEFAULTS }
};

const FOCUS_DEFAULTS = {
  hideLikes: true,
  hideComments: true,
  hideRecommendations: true,
  blurThumbnails: true,
  doomEnabled: true,
  doomCooldownSeconds: 30,
  doomWarningScore: 65,
  doomTriggerScore: 96
};

const HEARTBEAT_INTERVAL = 2000; // 2 seconds - interval for tracking state
const IDLE_DETECTION_SECONDS = 60;

const AI_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']
  },
  deepseek: {
    name: 'DeepSeek AI',
    endpoint: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner']
  }
};

const NOTIFICATION_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ============================================================================
// RUNTIME STATE
// ============================================================================

let runtimeState = {
  heartbeatTimer: null,
  activeTabId: null,
  activeUrl: '',
  activeTitle: '',
  lastHeartbeatTime: Date.now(),
  lastFlushTime: 0,
  isIdle: false,
  idleReason: 'active',
  youtubePlaybackTabId: null,
  youtubePlaybackActiveUntil: 0,
  currentEventStart: null // Track when current activity started
};

const youtubeShiftTimers = new Map();
const youtubeShiftDecisionCache = new Map();
const shortsSessionState = new Map();
const SHORTS_BLOCK_THRESHOLD_MS = 60 * 1000;

function normalizeShortsBlockSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 60;
  if (n <= 0) return 0;
  return Math.max(10, Math.min(7200, Math.round(n)));
}

function toLocalDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pruneDailyShortsBlockMap(rawMap) {
  const map = rawMap && typeof rawMap === 'object' ? rawMap : {};
  const out = {};
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 14);
  const cutoffKey = toLocalDayKey(cutoffDate);

  for (const [k, v] of Object.entries(map)) {
    if (k >= cutoffKey && !!v) {
      out[k] = true;
    }
  }

  return out;
}

async function getDailyShortsBlockMap() {
  const store = await chrome.storage.local.get(STORAGE_KEYS.DAILY_SHORTS_BLOCK);
  const current = store[STORAGE_KEYS.DAILY_SHORTS_BLOCK] || {};
  const pruned = pruneDailyShortsBlockMap(current);
  if (JSON.stringify(pruned) !== JSON.stringify(current)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.DAILY_SHORTS_BLOCK]: pruned });
  }
  return pruned;
}

async function isShortsBlockedForToday() {
  const todayKey = toLocalDayKey();
  const dailyMap = await getDailyShortsBlockMap();
  return !!dailyMap[todayKey];
}

async function markShortsBlockedForToday() {
  const todayKey = toLocalDayKey();
  const dailyMap = await getDailyShortsBlockMap();
  if (!dailyMap[todayKey]) {
    dailyMap[todayKey] = true;
    await chrome.storage.local.set({ [STORAGE_KEYS.DAILY_SHORTS_BLOCK]: dailyMap });
  }
}

async function getShortsBlockThresholdMs() {
  const store = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = normalizeSettings(store[STORAGE_KEYS.SETTINGS]);
  return normalizeShortsBlockSeconds(settings.shortsBlockSeconds) * 1000;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Initialize on service worker startup
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.tabs.query({}, (tabs) => {
      if (tabs.length > 0) {
        const activeTab = tabs.find(tab => tab.active) || tabs[0];
        if (activeTab) {
          updateActiveFromTab(activeTab);
        }
      }
    });
  }
});

// Start tracking current active tab on startup
async function initializeActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    updateActiveFromTab(tabs[0]);
  }
}

// ============================================================================
// TAB TRACKING LISTENERS
// ============================================================================

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (!tab) return;

  // Flush previous tab's activity before switching
  if (runtimeState.currentEventStart && runtimeState.activeTabId !== activeInfo.tabId) {
    await flushCurrentEvent();
  }

  updateActiveFromTab(tab);
  await enforceLimitForTab(tab);
});

// Listen for tab updates (URL or title changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only track if it's the active tab
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (activeTabs.length > 0 && activeTabs[0].id === tabId) {
    if (changeInfo.url || changeInfo.title) {
      // If URL changed, flush previous and start new event
      if (changeInfo.url && runtimeState.activeUrl !== changeInfo.url) {
        await flushCurrentEvent();
      }
      updateActiveFromTab(tab);
      await enforceLimitForTab(tab);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearYoutubeShiftTimer(tabId);
  clearShortsSession(tabId);
});

function isYoutubeShortsUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /(^|\.)youtube\.com$/i.test(u.hostname) && u.pathname.startsWith('/shorts');
  } catch {
    return false;
  }
}

function clearShortsSession(tabId) {
  shortsSessionState.delete(tabId);
}

async function maybeTriggerShortsBlock(tabId, session) {
  if (!session || session.blocked) return;
  const thresholdMs = Number(session.thresholdMs || SHORTS_BLOCK_THRESHOLD_MS);
  if (thresholdMs <= 0) return;
  if (session.accumulatedMs < thresholdMs) return;

  session.blocked = true;
  shortsSessionState.set(tabId, session);
  await markShortsBlockedForToday();

  await chrome.tabs.sendMessage(tabId, {
    type: 'shortsOverlay',
    mode: 'block',
    spentMs: session.accumulatedMs,
    thresholdSeconds: Math.max(1, Math.round(thresholdMs / 1000)),
    blockedToday: true
  }).catch(() => {});
}

async function handleShortsSessionStart(tabId, shortIdRaw) {
  const shortId = String(shortIdRaw || '').trim();
  if (!tabId) return { ok: false, error: 'Missing tab context' };

  const now = Date.now();
  const thresholdMs = await getShortsBlockThresholdMs();
  if (thresholdMs <= 0) {
    shortsSessionState.set(tabId, {
      accumulatedMs: 0,
      lastTickTs: now,
      wasActive: false,
      blocked: true,
      currentShortId: shortId,
      thresholdMs: 0
    });
    return {
      ok: true,
      blocked: true,
      blockedToday: false,
      noUsageLimit: true,
      accumulatedMs: 0,
      thresholdMs: 0,
      thresholdSeconds: 0
    };
  }

  if (thresholdMs > 0 && await isShortsBlockedForToday()) {
    shortsSessionState.set(tabId, {
      accumulatedMs: thresholdMs,
      lastTickTs: now,
      wasActive: false,
      blocked: true,
      currentShortId: shortId,
      thresholdMs
    });
    return {
      ok: true,
      blockedToday: true,
      blocked: true,
      noUsageLimit: false,
      accumulatedMs: thresholdMs,
      thresholdMs,
      thresholdSeconds: Math.max(1, Math.round(thresholdMs / 1000))
    };
  }

  shortsSessionState.set(tabId, {
    accumulatedMs: 0,
    lastTickTs: now,
    wasActive: false,
    blocked: false,
    currentShortId: shortId,
    thresholdMs
  });

  return {
    ok: true,
    blocked: false,
    blockedToday: false,
    noUsageLimit: false,
    accumulatedMs: 0,
    thresholdMs,
    thresholdSeconds: Math.max(0, Math.round(thresholdMs / 1000))
  };
}

async function handleShortsSessionTick(tabId, active, shortIdRaw) {
  if (!tabId) return { ok: false, error: 'Missing tab context' };

  const now = Date.now();
  const shortId = String(shortIdRaw || '').trim();
  const session = shortsSessionState.get(tabId) || {
    accumulatedMs: 0,
    lastTickTs: now,
    wasActive: false,
    blocked: false,
    currentShortId: '',
    thresholdMs: SHORTS_BLOCK_THRESHOLD_MS
  };

  // When Shorts feed moves to a different item, reset the active anchor to avoid
  // accidentally carrying delta from the previous short into the next one.
  if (shortId && shortId !== session.currentShortId) {
    session.currentShortId = shortId;
    session.lastTickTs = now;
    session.wasActive = false;
  }

  const deltaMs = Math.max(0, Math.min(10000, now - Number(session.lastTickTs || now)));
  if (active && session.wasActive) {
    session.accumulatedMs += deltaMs;
  }

  session.lastTickTs = now;
  session.wasActive = !!active;
  shortsSessionState.set(tabId, session);

  await maybeTriggerShortsBlock(tabId, session);
  const thresholdMs = Number(session.thresholdMs || SHORTS_BLOCK_THRESHOLD_MS);
  const noUsageLimit = thresholdMs <= 0;
  return {
    ok: true,
    accumulatedMs: session.accumulatedMs,
    blocked: session.blocked,
    currentShortId: session.currentShortId,
    thresholdSeconds: Math.max(0, Math.round(thresholdMs / 1000)),
    blockedToday: thresholdMs > 0
      ? (session.blocked && (await isShortsBlockedForToday()))
      : false,
    noUsageLimit
  };
}

async function handleShortsSessionEnd(tabId) {
  if (!tabId) return { ok: false, error: 'Missing tab context' };

  clearShortsSession(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'shortsOverlay', mode: 'clear' }).catch(() => {});
  return { ok: true };
}

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Window lost focus - flush now so unfocused gap is not backfilled later.
    if (!runtimeState.isIdle) {
      flushCurrentEvent();
    }
    runtimeState.isIdle = true;
    runtimeState.idleReason = 'window-unfocused';
  } else {
    // Window regained focus - resume from now.
    if (runtimeState.isIdle && runtimeState.activeUrl) {
      runtimeState.currentEventStart = Date.now();
      runtimeState.lastHeartbeatTime = Date.now();
    }
    runtimeState.isIdle = false;
    runtimeState.idleReason = 'active';
  }
});

// ============================================================================
// IDLE STATE TRACKING
// ============================================================================

// Listen for idle state changes (requires "idle" permission)
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === 'locked') {
    // Locked state - user away, flush current event
    runtimeState.isIdle = true;
    runtimeState.idleReason = 'locked';
    flushCurrentEvent();
  } else if (newState === 'idle') {
    // Idle state - stop counting when there is no user interaction.
    if (!runtimeState.isIdle) {
      flushCurrentEvent();
    }
    runtimeState.isIdle = true;
    runtimeState.idleReason = 'idle';
  } else if (newState === 'active') {
    // Back to active; resume from now to avoid counting idle gap.
    if (runtimeState.isIdle && runtimeState.activeUrl) {
      runtimeState.currentEventStart = Date.now();
      runtimeState.lastHeartbeatTime = Date.now();
    }
    runtimeState.isIdle = false;
    runtimeState.idleReason = 'active';
  }
});

// ============================================================================
// HEARTBEAT SYSTEM
// ============================================================================

// Start the heartbeat timer
function startHeartbeat() {
  if (runtimeState.heartbeatTimer) {
    clearInterval(runtimeState.heartbeatTimer);
  }
  
  runtimeState.currentEventStart = Date.now();
  runtimeState.lastHeartbeatTime = Date.now();
  
  runtimeState.heartbeatTimer = setInterval(() => {
    if (!runtimeState.isIdle && runtimeState.activeTabId && runtimeState.activeUrl) {
      sendHeartbeat();
    }
  }, HEARTBEAT_INTERVAL);
}

// Stop the heartbeat timer
function stopHeartbeat() {
  if (runtimeState.heartbeatTimer) {
    clearInterval(runtimeState.heartbeatTimer);
    runtimeState.heartbeatTimer = null;
  }
  flushCurrentEvent();
}

async function getSystemIdleState() {
  return new Promise((resolve) => {
    chrome.idle.queryState(IDLE_DETECTION_SECONDS, (state) => {
      resolve(state || 'active');
    });
  });
}

// Send a heartbeat signal (accumulate time)
async function sendHeartbeat() {
  const isForeground = await isCurrentlyForegroundTrackedTab();
  if (!isForeground) return;

  const now = Date.now();
  const playbackOverride = hasActiveYoutubePlaybackOverride(now);
  const systemState = await getSystemIdleState();
  if (systemState !== 'active' && !playbackOverride) {
    if (!runtimeState.isIdle) {
      await flushCurrentEvent();
    }
    runtimeState.isIdle = true;
    runtimeState.idleReason = systemState;
    return;
  } else if (runtimeState.isIdle && runtimeState.activeUrl) {
    runtimeState.currentEventStart = now;
    runtimeState.lastHeartbeatTime = now;
    runtimeState.isIdle = false;
    runtimeState.idleReason = playbackOverride ? 'video-playing' : 'active';
  }

  const timeSinceLastHeartbeat = (now - runtimeState.lastHeartbeatTime) / 1000; // in seconds
  
  runtimeState.lastHeartbeatTime = now;
  
  // Throttle flushes to prevent race conditions - only flush every 500ms max
  if (now - runtimeState.lastFlushTime >= 500) {
    await addTimeToCurrentDomain(runtimeState.activeUrl, timeSinceLastHeartbeat);
    runtimeState.lastFlushTime = now;
    runtimeState.currentEventStart = now;
    
    // Check limits after each heartbeat
    await evaluateLimitsAndNotify();
    chrome.runtime.sendMessage({ type: 'statsUpdated' }).catch(() => {});
  }
}

async function isCurrentlyForegroundTrackedTab() {
  if (!runtimeState.activeTabId || !runtimeState.activeUrl) return false;

  const trackedTab = await chrome.tabs.get(runtimeState.activeTabId).catch(() => null);
  if (!trackedTab || !trackedTab.active) return false;

  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (!activeTabs.length) return false;

  const activeTab = activeTabs[0];
  if (activeTab.id !== runtimeState.activeTabId) return false;

  const trackedUrl = String(runtimeState.activeUrl || '');
  const activeUrl = String(activeTab.url || '');
  return activeUrl === trackedUrl;
}

// Flush current event when switching tabs/URLs/locking
async function flushCurrentEvent() {
  if (runtimeState.currentEventStart && runtimeState.activeUrl) {
    // Only flush residual time since last accounted heartbeat.
    const duration = (Date.now() - runtimeState.lastHeartbeatTime) / 1000; // in seconds
    if (duration > 0) {
      await addTimeToCurrentDomain(runtimeState.activeUrl, duration);
      await evaluateLimitsAndNotify();
      chrome.runtime.sendMessage({ type: 'statsUpdated' }).catch(() => {});
    }
  }
  runtimeState.currentEventStart = null;
  runtimeState.lastHeartbeatTime = Date.now();
}

// ============================================================================
// UPDATE ACTIVE TAB
// ============================================================================

function updateActiveFromTab(tab) {
  if (!tab || !tab.url) return;
  
  // Skip non-http tabs
  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
    return;
  }
  
  runtimeState.activeTabId = tab.id;
  runtimeState.activeUrl = tab.url;
  runtimeState.activeTitle = tab.title || '';
  runtimeState.currentEventStart = Date.now();
  runtimeState.lastHeartbeatTime = Date.now();
  runtimeState.isIdle = false;
  runtimeState.idleReason = 'active';
  if (runtimeState.youtubePlaybackTabId !== tab.id) {
    runtimeState.youtubePlaybackActiveUntil = 0;
  }
}

// ============================================================================
// STORAGE & TIME TRACKING
// ============================================================================

// Add time to current domain/category
async function addTimeToCurrentDomain(url, seconds) {
  if (seconds <= 0 || !url) return;
  
  const domain = canonicalDomain(new URL(url).hostname);
  const today = new Date().toISOString().split('T')[0];
  const categories = await getCategories();
  const category = getCategoryForDomain(domain, categories);
  
  const data = await chrome.storage.local.get(STORAGE_KEYS.DAILY_USAGE);
  const dailyUsage = data[STORAGE_KEYS.DAILY_USAGE] || {};
  
  if (!dailyUsage[today]) {
    dailyUsage[today] = {
      totalSeconds: 0,
      domains: {},
      categories: {},
      hours: {}
    };
  }
  
  const dayData = dailyUsage[today];
  dayData.totalSeconds = (dayData.totalSeconds || 0) + seconds;
  dayData.domains[domain] = (dayData.domains[domain] || 0) + seconds;
  dayData.categories[category] = (dayData.categories[category] || 0) + seconds;
  
  const hour = new Date().getHours();
  dayData.hours[hour] = (dayData.hours[hour] || 0) + seconds;
  
  await chrome.storage.local.set({ [STORAGE_KEYS.DAILY_USAGE]: dailyUsage });
}

// Get categories configuration
async function getCategories() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.CATEGORIES, STORAGE_KEYS.SETTINGS]);
  return data[STORAGE_KEYS.CATEGORIES]
    || data[STORAGE_KEYS.SETTINGS]?.categories
    || DEFAULT_SETTINGS.categories;
}

// Categorize URL based on domain
function getCategoryForDomain(domain, categories) {
  for (const [category, domains] of Object.entries(categories)) {
    for (const d of domains) {
      if (domain.includes(d)) {
        return category;
      }
    }
  }
  return 'Other';
}

function canonicalDomain(domain) {
  const host = String(domain || '').trim().toLowerCase();
  if (!host) return host;
  return host.replace(/^www\./, '');
}

function domainMatchesLimitKey(domain, limitDomain) {
  const a = canonicalDomain(domain);
  const b = canonicalDomain(limitDomain);
  return a === b || a.endsWith(`.${b}`);
}

function getUsedSecondsForDomainLimit(domainsMap, limitDomain) {
  let total = 0;
  for (const [domain, seconds] of Object.entries(domainsMap || {})) {
    if (domainMatchesLimitKey(domain, limitDomain)) {
      total += Number(seconds) || 0;
    }
  }
  return total;
}

function normalizeDomainMap(domainsMap) {
  const merged = {};
  for (const [domain, seconds] of Object.entries(domainsMap || {})) {
    const key = canonicalDomain(domain);
    merged[key] = (merged[key] || 0) + (Number(seconds) || 0);
  }
  return merged;
}

function normalizeDayDomains(day) {
  return {
    ...day,
    domains: normalizeDomainMap(day?.domains || {})
  };
}

function emptyDayBucket() {
  return {
    totalSeconds: 0,
    domains: {},
    categories: {},
    hours: {}
  };
}

function fmtSeconds(seconds) {
  const mins = Math.floor((seconds || 0) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function normalizeSettings(raw) {
  const src = raw || {};
  return {
    ...DEFAULT_SETTINGS,
    ...src,
    categories: {
      ...DEFAULT_SETTINGS.categories,
      ...(src.categories || {})
    },
    categoryLimitsMinutes: {
      ...DEFAULT_SETTINGS.categoryLimitsMinutes,
      ...(src.categoryLimitsMinutes || {})
    },
    domainLimitsMinutes: {
      ...DEFAULT_SETTINGS.domainLimitsMinutes,
      ...(src.domainLimitsMinutes || {})
    },
    aiInsights: {
      ...DEFAULT_SETTINGS.aiInsights,
      ...(src.aiInsights || {})
    },
    shortsBlockSeconds: normalizeShortsBlockSeconds(src.shortsBlockSeconds),
    youtubeShiftGuard: normalizeYoutubeShiftGuard(src.youtubeShiftGuard)
  };
}

function normalizeYoutubeShiftGuard(raw) {
  const src = raw || {};
  const warnSeconds = Number(src.warnSeconds);
  const blockSeconds = Number(src.blockSeconds);
  const cooldownSeconds = Number(src.cooldownSeconds);
  const cacheTtlSeconds = Number(src.cacheTtlSeconds);
  const severityThreshold = String(src.severityThreshold || YOUTUBE_SHIFT_DEFAULTS.severityThreshold).toLowerCase();
  const monitoredPairs = Array.isArray(src.monitoredPairs)
    ? src.monitoredPairs.map((x) => String(x || '').trim()).filter(Boolean)
    : YOUTUBE_SHIFT_DEFAULTS.monitoredPairs;

  return {
    ...YOUTUBE_SHIFT_DEFAULTS,
    ...src,
    enabled: src.enabled !== false,
    aiEnabled: src.aiEnabled !== false,
    warnSeconds: Number.isFinite(warnSeconds) ? Math.max(2, Math.min(20, Math.round(warnSeconds))) : YOUTUBE_SHIFT_DEFAULTS.warnSeconds,
    blockSeconds: Number.isFinite(blockSeconds) ? Math.max(10, Math.min(300, Math.round(blockSeconds))) : YOUTUBE_SHIFT_DEFAULTS.blockSeconds,
    cooldownSeconds: Number.isFinite(cooldownSeconds) ? Math.max(10, Math.min(1800, Math.round(cooldownSeconds))) : YOUTUBE_SHIFT_DEFAULTS.cooldownSeconds,
    cacheTtlSeconds: Number.isFinite(cacheTtlSeconds) ? Math.max(60, Math.min(86400, Math.round(cacheTtlSeconds))) : YOUTUBE_SHIFT_DEFAULTS.cacheTtlSeconds,
    severityThreshold: ['low', 'medium', 'high'].includes(severityThreshold) ? severityThreshold : YOUTUBE_SHIFT_DEFAULTS.severityThreshold,
    monitoredPairs: monitoredPairs.length ? monitoredPairs : YOUTUBE_SHIFT_DEFAULTS.monitoredPairs
  };
}

function isYoutubeWatchUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /(^|\.)youtube\.com$/i.test(u.hostname) && u.pathname === '/watch' && !!u.searchParams.get('v');
  } catch {
    return false;
  }
}

function hasActiveYoutubePlaybackOverride(nowTs = Date.now()) {
  if (!runtimeState.activeTabId) return false;
  if (runtimeState.youtubePlaybackTabId !== runtimeState.activeTabId) return false;
  if (nowTs > Number(runtimeState.youtubePlaybackActiveUntil || 0)) return false;
  return isYoutubeWatchUrl(runtimeState.activeUrl);
}

function parseYouTubeVideoId(url) {
  try {
    const u = new URL(String(url || ''));
    return String(u.searchParams.get('v') || '').trim();
  } catch {
    return '';
  }
}

function severityRank(severity) {
  const s = String(severity || 'low').toLowerCase();
  if (s === 'high') return 3;
  if (s === 'medium') return 2;
  return 1;
}

function meetsSeverityThreshold(severity, threshold) {
  return severityRank(severity) >= severityRank(threshold);
}

function classifyYouTubeTitle(title, channelName) {
  const t = String(title || '').toLowerCase();
  const c = String(channelName || '').toLowerCase();
  const combined = `${t} ${c}`;

  const productiveKeywords = [
    'dsa',
    'data structure',
    'algorithm',
    'leetcode',
    'system design',
    'coding',
    'programming',
    'tutorial',
    'course',
    'lesson',
    'interview',
    'backend',
    'frontend',
    'react',
    'node',
    'python',
    'java',
    'devops'
  ];

  const learningKeywords = [
    'learn',
    'explained',
    'guide',
    'basics',
    'full stack',
    'machine learning',
    'ai',
    'math',
    'physics'
  ];

  const socialKeywords = ['podcast', 'interview with', 'debate', 'reddit'];

  const distractingKeywords = [
    'vlog',
    'travel',
    'reaction',
    'prank',
    'meme',
    'funny',
    'challenge',
    'live stream',
    'gameplay',
    'pewdiepie',
    'mrbeast',
    'music video'
  ];

  const entertainmentChannels = [
    'mrbeast',
    'pewdiepie',
    'sidemen',
    'ishowspeed',
    'ksi',
    'logan paul'
  ];

  if (productiveKeywords.some((k) => combined.includes(k))) return 'Productive';
  if (learningKeywords.some((k) => combined.includes(k))) return 'Learning';
  if (socialKeywords.some((k) => combined.includes(k))) return 'Social';
  if (distractingKeywords.some((k) => combined.includes(k))) return 'Entertainment';
  if (entertainmentChannels.some((k) => c.includes(k))) return 'Entertainment';

  // For YouTube watch videos, default unknown topics to Entertainment so
  // productivity guard remains conservative.
  return 'Entertainment';
}

function shouldMonitorShiftPair(fromLabel, toLabel, guard) {
  const pair = `${fromLabel}->${toLabel}`;
  return (guard.monitoredPairs || []).includes(pair);
}

function evaluateYouTubeShiftHeuristic(previousTitle, currentTitle, fromLabel, toLabel) {
  if (!previousTitle || !currentTitle) {
    return { isDistraction: false, severity: 'low', reason: 'Insufficient context.' };
  }

  const strictShift =
    (fromLabel === 'Learning' || fromLabel === 'Productive')
    && (toLabel === 'Entertainment' || toLabel === 'Social');

  if (strictShift) {
    return {
      isDistraction: true,
      severity: 'high',
      reason: `Context shifted from ${fromLabel} to ${toLabel}.`
    };
  }

  if (toLabel === 'Entertainment' || toLabel === 'Social') {
    return {
      isDistraction: true,
      severity: 'medium',
      reason: `Current video appears ${toLabel.toLowerCase()} focused.`
    };
  }

  return {
    isDistraction: false,
    severity: 'low',
    reason: 'Shift looks safe by heuristic.'
  };
}

function parseAiShiftDecision(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  return {
    isDistraction: !!parsed.isDistraction,
    severity: ['low', 'medium', 'high'].includes(String(parsed.severity || '').toLowerCase())
      ? String(parsed.severity).toLowerCase()
      : 'medium',
    reason: String(parsed.reason || '').trim() || 'AI flagged a context shift.'
  };
}

async function requestYoutubeShiftDecisionWithAi(previousTitle, currentTitle, fromLabel, toLabel, settings) {
  const ai = settings.aiInsights || {};
  if (!ai.enabled) return null;

  const providerKey = AI_PROVIDERS[ai.provider] ? ai.provider : 'openai';
  const provider = AI_PROVIDERS[providerKey];
  const endpoint = String(ai.endpoint || provider.endpoint).trim();
  const model = String(ai.model || provider.models?.[0] || 'gpt-4').trim();
  const apiKey = String(ai.apiKey || '').trim();

  if (!endpoint || !model || !apiKey) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content: 'Classify whether a YouTube context shift is distracting. Return strict JSON only: {"isDistraction": boolean, "severity": "low|medium|high", "reason": "short reason"}.'
          },
          {
            role: 'user',
            content: `Previous video: "${previousTitle}" (${fromLabel}). Current video: "${currentTitle}" (${toLabel}). Is this shift distracting to productivity?`
          }
        ]
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return parseAiShiftDecision(content);
  } catch {
    return null;
  }
}

async function getYouTubeShiftDecision(previousTitle, currentTitle, fromLabel, toLabel, settings, guard) {
  const key = `${fromLabel}|${toLabel}|${String(previousTitle).toLowerCase()}|${String(currentTitle).toLowerCase()}`;
  const now = Date.now();
  const cacheTtlMs = Number(guard.cacheTtlSeconds || YOUTUBE_SHIFT_DEFAULTS.cacheTtlSeconds) * 1000;
  const cached = youtubeShiftDecisionCache.get(key);
  if (cached && now - cached.ts < cacheTtlMs) {
    return cached.decision;
  }

  const heuristic = evaluateYouTubeShiftHeuristic(previousTitle, currentTitle, fromLabel, toLabel);
  let decision = heuristic;

  if (guard.aiEnabled) {
    const aiDecision = await requestYoutubeShiftDecisionWithAi(previousTitle, currentTitle, fromLabel, toLabel, settings);
    if (aiDecision) {
      const mergedSeverity = severityRank(aiDecision.severity) >= severityRank(heuristic.severity)
        ? aiDecision.severity
        : heuristic.severity;
      decision = {
        isDistraction: !!(heuristic.isDistraction || aiDecision.isDistraction),
        severity: mergedSeverity,
        reason: aiDecision.reason || heuristic.reason
      };
    }
  }

  youtubeShiftDecisionCache.set(key, { ts: now, decision });
  return decision;
}

function clearYoutubeShiftTimer(tabId) {
  const running = youtubeShiftTimers.get(tabId);
  if (running?.timeoutId) {
    clearTimeout(running.timeoutId);
  }
  youtubeShiftTimers.delete(tabId);
}

async function appendYoutubeShiftHistory(event) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY);
  const history = Array.isArray(data[STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY]) ? data[STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY] : [];
  history.unshift(event);
  const capped = history.slice(0, 100);
  await chrome.storage.local.set({ [STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY]: capped });
}

async function markYoutubeShiftCooldown(tabId, secondsOverride) {
  const store = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT]);
  const settings = normalizeSettings(store[STORAGE_KEYS.SETTINGS]);
  const contextRoot = store[STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT] || { byTab: {} };
  const tabContext = contextRoot.byTab?.[tabId] || {};
  const cooldownSeconds = Number(secondsOverride || settings.youtubeShiftGuard.cooldownSeconds || YOUTUBE_SHIFT_DEFAULTS.cooldownSeconds);

  tabContext.cooldownUntil = Date.now() + cooldownSeconds * 1000;
  tabContext.pendingToken = '';
  contextRoot.byTab = contextRoot.byTab || {};
  contextRoot.byTab[tabId] = tabContext;

  await chrome.storage.local.set({ [STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT]: contextRoot });
  clearYoutubeShiftTimer(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'youtubeShiftOverlay', mode: 'clear' }).catch(() => {});
}

async function handleYoutubeVideoChanged(request, tabId) {
  if (!tabId) return { ok: false, error: 'Missing tab id' };

  clearShortsSession(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'shortsOverlay', mode: 'clear' }).catch(() => {});

  const url = String(request?.url || '');
  if (!isYoutubeWatchUrl(url)) {
    clearYoutubeShiftTimer(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'youtubeShiftOverlay', mode: 'clear' }).catch(() => {});
    return { ok: true, ignored: 'not-watch' };
  }

  const videoId = String(request?.videoId || parseYouTubeVideoId(url)).trim();
  const title = String(request?.title || '').trim();
  const channelName = String(request?.channelName || '').trim();
  if (!videoId || !title) return { ok: true, ignored: 'missing-video' };

  const store = await chrome.storage.local.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT
  ]);

  const settings = normalizeSettings(store[STORAGE_KEYS.SETTINGS]);
  const guard = settings.youtubeShiftGuard;
  if (!guard.enabled) return { ok: true, disabled: true };

  const contextRoot = store[STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT] || { byTab: {} };
  contextRoot.byTab = contextRoot.byTab || {};

  const tabContext = contextRoot.byTab[tabId] || {};
  if (
    tabContext.lastVideoId === videoId
    && String(tabContext.lastTitle || '').toLowerCase() === title.toLowerCase()
  ) {
    return { ok: true, dedup: true };
  }

  clearYoutubeShiftTimer(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'youtubeShiftOverlay', mode: 'clear' }).catch(() => {});

  const now = Date.now();
  const currentLabel = classifyYouTubeTitle(title, channelName);
  const previousTitle = String(tabContext.lastTitle || '').trim();
  const previousLabel = String(tabContext.lastLabel || 'Other');
  const previousUrl = String(tabContext.lastUrl || '').trim();
  const isCoolingDown = now < Number(tabContext.cooldownUntil || 0);
  const pairMatched = shouldMonitorShiftPair(previousLabel, currentLabel, guard);
  const shouldCheckShift =
    !!previousTitle
    && previousTitle.toLowerCase() !== title.toLowerCase()
    && !isCoolingDown
    && pairMatched;

  let decision = null;

  if (shouldCheckShift) {
    decision = await getYouTubeShiftDecision(previousTitle, title, previousLabel, currentLabel, settings, guard);
    const shouldBlock =
      !!decision?.isDistraction
      && meetsSeverityThreshold(decision.severity, guard.severityThreshold);

    await appendYoutubeShiftHistory({
      ts: now,
      tabId,
      fromTitle: previousTitle,
      toTitle: title,
      fromLabel: previousLabel,
      toLabel: currentLabel,
      decision,
      blocked: shouldBlock
    });

    if (shouldBlock) {
      const token = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      const warnSeconds = Number(guard.warnSeconds || YOUTUBE_SHIFT_DEFAULTS.warnSeconds);
      const blockSeconds = Number(guard.blockSeconds || YOUTUBE_SHIFT_DEFAULTS.blockSeconds);

      tabContext.pendingToken = token;
      tabContext.pendingUntil = now + warnSeconds * 1000;

      await chrome.tabs.sendMessage(tabId, {
        type: 'youtubeShiftOverlay',
        mode: 'warning',
        seconds: warnSeconds,
        fromLabel: previousLabel,
        toLabel: currentLabel,
        reason: decision.reason
      }).catch(() => {});

      const timeoutId = setTimeout(async () => {
        const latestStore = await chrome.storage.local.get(STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT).catch(() => ({}));
        const latestRoot = latestStore[STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT] || { byTab: {} };
        const latestTab = latestRoot.byTab?.[tabId] || {};
        if (latestTab.pendingToken !== token) return;

        await chrome.tabs.sendMessage(tabId, {
          type: 'youtubeShiftOverlay',
          mode: 'block',
          reason: decision.reason,
          previousUrl
        }).catch(() => {});

        latestTab.pendingToken = '';
        latestRoot.byTab = latestRoot.byTab || {};
        latestRoot.byTab[tabId] = latestTab;
        await chrome.storage.local.set({ [STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT]: latestRoot }).catch(() => {});
      }, warnSeconds * 1000);

      youtubeShiftTimers.set(tabId, { timeoutId, token });
    }
  }

  tabContext.lastVideoId = videoId;
  tabContext.lastTitle = title;
  tabContext.lastLabel = currentLabel;
  tabContext.lastUrl = url;
  tabContext.lastSeenTs = now;

  contextRoot.byTab[tabId] = tabContext;
  await chrome.storage.local.set({ [STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT]: contextRoot });

  await chrome.tabs.sendMessage(tabId, {
    type: 'youtubeShiftDebug',
    previousLabel,
    currentLabel,
    monitoredPairMatch: pairMatched,
    finalSeverity: decision?.severity || 'none',
    finalDecision: decision?.isDistraction === true ? 'distracting' : (decision ? 'safe' : 'not-evaluated')
  }).catch(() => {});

  return { ok: true, checked: shouldCheckShift, decision };
}

function normalizeFocusSettings(raw) {
  return { ...FOCUS_DEFAULTS, ...(raw || {}) };
}

function limitSecondsFromMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * 60;
}

function aggregateDays(data, dayKeys) {
  const result = emptyDayBucket();
  for (const key of dayKeys) {
    const day = data[key];
    if (!day) continue;
    result.totalSeconds += day.totalSeconds || 0;
    for (const [domain, seconds] of Object.entries(day.domains || {})) {
      result.domains[domain] = (result.domains[domain] || 0) + seconds;
    }
    for (const [cat, seconds] of Object.entries(day.categories || {})) {
      result.categories[cat] = (result.categories[cat] || 0) + seconds;
    }
    for (const [hour, seconds] of Object.entries(day.hours || {})) {
      result.hours[hour] = (result.hours[hour] || 0) + seconds;
    }
  }
  return result;
}

function buildInsights(today, week) {
  const insights = [];
  const tCat = today.categories || {};
  const total = today.totalSeconds || 0;
  const productive = (tCat.Productive || 0) + (tCat.Learning || 0);
  const distracting = (tCat.Entertainment || 0) + (tCat.Social || 0);

  if (total > 0) {
    const distractingPct = Math.round((distracting / total) * 100);
    const productivePct = Math.round((productive / total) * 100);
    insights.push(`Today tracked: ${fmtSeconds(total)}. Productive ${productivePct}%, distracting ${distractingPct}%.`);
  }

  const topSite = Object.entries(today.domains || {}).sort((a, b) => b[1] - a[1])[0];
  if (topSite) insights.push(`Most-used site today: ${topSite[0]} (${fmtSeconds(topSite[1])}).`);

  const weekTotal = week.totalSeconds || 0;
  if (weekTotal > 0) {
    const weekAvg = Math.round(weekTotal / 7);
    insights.push(`7-day daily average: ${fmtSeconds(weekAvg)}.`);
  }

  if (!insights.length) insights.push('No activity yet. Start browsing to generate insights.');
  return insights;
}

function computeLimitsStatus(today, settings) {
  const rows = [];

  for (const [domain, minutes] of Object.entries(settings.domainLimitsMinutes || {})) {
    const used = getUsedSecondsForDomainLimit(today.domains || {}, domain);
    const max = limitSecondsFromMinutes(minutes) || 0;
    rows.push({ key: `domain:${domain}`, label: domain, used, max, overLimit: max > 0 && used >= max });
  }

  for (const [cat, minutes] of Object.entries(settings.categoryLimitsMinutes || {})) {
    const used = (today.categories || {})[cat] || 0;
    const max = limitSecondsFromMinutes(minutes) || 0;
    rows.push({ key: `category:${cat}`, label: cat, used, max, overLimit: max > 0 && used >= max });
  }

  return rows;
}

async function ensureDefaults() {
  const store = await chrome.storage.local.get([
    STORAGE_KEYS.DAILY_USAGE,
    STORAGE_KEYS.ALERTS_SHOWN,
    STORAGE_KEYS.DAILY_SHORTS_BLOCK,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.CATEGORIES,
    STORAGE_KEYS.LIMITS,
    STORAGE_KEYS.LATEST_AI_INSIGHT,
    STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT,
    STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY
  ]);

  const normalized = normalizeSettings(store[STORAGE_KEYS.SETTINGS]);
  const next = {};

  if (!store[STORAGE_KEYS.DAILY_USAGE]) next[STORAGE_KEYS.DAILY_USAGE] = {};
  if (!store[STORAGE_KEYS.ALERTS_SHOWN]) next[STORAGE_KEYS.ALERTS_SHOWN] = {};
  if (!store[STORAGE_KEYS.DAILY_SHORTS_BLOCK]) next[STORAGE_KEYS.DAILY_SHORTS_BLOCK] = {};
  if (!store[STORAGE_KEYS.SETTINGS]) next[STORAGE_KEYS.SETTINGS] = normalized;
  if (!store[STORAGE_KEYS.CATEGORIES]) next[STORAGE_KEYS.CATEGORIES] = normalized.categories;
  if (!store[STORAGE_KEYS.LIMITS]) next[STORAGE_KEYS.LIMITS] = normalized.categoryLimitsMinutes;
  if (store[STORAGE_KEYS.LATEST_AI_INSIGHT] == null) next[STORAGE_KEYS.LATEST_AI_INSIGHT] = '';
  if (!store[STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT]) next[STORAGE_KEYS.YOUTUBE_TITLE_CONTEXT] = { byTab: {} };
  if (!store[STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY]) next[STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY] = [];

  if (Object.keys(next).length) {
    await chrome.storage.local.set(next);
  }

  const focusStore = await chrome.storage.sync.get(FOCUS_DEFAULTS);
  await chrome.storage.sync.set(normalizeFocusSettings(focusStore));
}

async function buildSnapshot() {
  const [store, focusRaw] = await Promise.all([
    chrome.storage.local.get([
      STORAGE_KEYS.DAILY_USAGE,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.LATEST_AI_INSIGHT,
      STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY
    ]),
    chrome.storage.sync.get(FOCUS_DEFAULTS)
  ]);

  const data = store[STORAGE_KEYS.DAILY_USAGE] || {};
  const settings = normalizeSettings(store[STORAGE_KEYS.SETTINGS]);
  const focusSettings = normalizeFocusSettings(focusRaw);

  const todayKey = new Date().toISOString().slice(0, 10);
  const dayKeys = Object.keys(data).sort();
  const last7 = dayKeys.slice(-7);

  const today = normalizeDayDomains(data[todayKey] || emptyDayBucket());
  const week = normalizeDayDomains(aggregateDays(data, last7));
  const insights = buildInsights(today, week);
  const limitsStatus = computeLimitsStatus(today, settings);
  const aiInsight = String(store[STORAGE_KEYS.LATEST_AI_INSIGHT] || '').trim();
  const youtubeShiftHistory = Array.isArray(store[STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY])
    ? store[STORAGE_KEYS.YOUTUBE_SHIFT_HISTORY]
    : [];

  return {
    todayKey,
    today,
    week,
    history: data,
    settings,
    focusSettings,
    insights,
    limitsStatus,
    aiInsight,
    youtubeShiftHistory
  };
}

function toCsv(snapshot) {
  const lines = ['date,domain,category,seconds'];
  const history = snapshot.history || {};
  const categories = snapshot.settings?.categories || {};

  for (const [day, record] of Object.entries(history)) {
    const domains = record.domains || {};
    for (const [domain, sec] of Object.entries(domains)) {
      const category = getCategoryForDomain(domain, categories);
      lines.push(`${day},${domain},${category},${Math.round(sec)}`);
    }
  }

  return lines.join('\n');
}

async function requestAiInsights(snapshot, settings) {
  const ai = settings.aiInsights || {};
  if (!ai.enabled) return 'AI insights are disabled. Enable them in settings first.';

  const providerKey = AI_PROVIDERS[ai.provider] ? ai.provider : 'openai';
  const provider = AI_PROVIDERS[providerKey];
  const endpoint = String(ai.endpoint || provider.endpoint).trim();
  const model = String(ai.model || provider.models?.[0] || 'gpt-4').trim();
  const apiKey = String(ai.apiKey || '').trim();

  if (!endpoint || !model || !apiKey) {
    return 'Please provide AI endpoint, model, and API key in settings.';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: 'system', content: ai.systemPrompt || DEFAULT_SETTINGS.aiInsights.systemPrompt },
          {
            role: 'user',
            content: `Today total: ${fmtSeconds(snapshot.today.totalSeconds || 0)}\nTop domains: ${Object.keys(snapshot.today.domains || {}).slice(0, 5).join(', ') || 'none'}\nGive: 1) diagnosis, 2) three actions, 3) one warning.`
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return `AI request failed (${response.status}): ${text.slice(0, 220)}`;
    }

    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || 'No AI content returned.').trim();
  } catch (error) {
    return `AI request error: ${String(error?.message || error)}`;
  }
}

// ============================================================================
// LIMITS & NOTIFICATIONS
// ============================================================================

async function evaluateLimitsAndNotify() {
  if (!runtimeState.activeTabId) return;
  const tab = await chrome.tabs.get(runtimeState.activeTabId).catch(() => null);
  if (!tab) return;
  await enforceLimitForTab(tab);
}

async function getLimitHitForTab(tab) {
  if (!tab?.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  const store = await chrome.storage.local.get([
    STORAGE_KEYS.DAILY_USAGE,
    STORAGE_KEYS.SETTINGS
  ]);

  const settings = normalizeSettings(store[STORAGE_KEYS.SETTINGS]);
  const data = store[STORAGE_KEYS.DAILY_USAGE] || {};
  const dayData = data[today] || emptyDayBucket();

  const domain = canonicalDomain(new URL(tab.url).hostname);

  for (const [limitDomain, limitMinutes] of Object.entries(settings.domainLimitsMinutes || {})) {
    const maxSeconds = limitSecondsFromMinutes(limitMinutes);
    if (!maxSeconds) continue;
    if (!domainMatchesLimitKey(domain, limitDomain)) continue;

    const usedSeconds = getUsedSecondsForDomainLimit(dayData.domains || {}, limitDomain);
    if (usedSeconds >= maxSeconds) {
      return {
        key: `domain:${canonicalDomain(limitDomain)}`,
        title: canonicalDomain(limitDomain),
        message: `Domain limit reached for ${canonicalDomain(limitDomain)}.`
      };
    }
  }

  const category = getCategoryForDomain(domain, settings.categories || DEFAULT_SETTINGS.categories);
  const categoryLimitMinutes = Number(settings.categoryLimitsMinutes?.[category] || 0);
  const categoryMaxSeconds = limitSecondsFromMinutes(categoryLimitMinutes);
  const categoryUsedSeconds = (dayData.categories || {})[category] || 0;

  if (categoryMaxSeconds && categoryUsedSeconds >= categoryMaxSeconds) {
    return {
      key: `category:${category}`,
      title: category,
      message: `Category limit reached for ${category}.`
    };
  }

  return null;
}

async function enforceLimitForTab(tab) {
  const hit = await getLimitHitForTab(tab);
  if (!hit) return false;

  const today = new Date().toISOString().split('T')[0];
  const settingsStore = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = normalizeSettings(settingsStore[STORAGE_KEYS.SETTINGS]);
  const shouldAlert = !!settings.alertEnabled;
  const shouldBlock = !!settings.blockAfterLimit;

  const alertsShown = shouldAlert ? await getAlertsShown() : {};
  const alertKey = `${today}-${hit.key}`;

  if (shouldAlert && !alertsShown[alertKey]) {
    showNotification(hit.title, hit.message);
    alertsShown[alertKey] = true;
    await chrome.storage.local.set({ [STORAGE_KEYS.ALERTS_SHOWN]: alertsShown });
  }

  if (!shouldBlock) {
    return false;
  }

  await chrome.tabs.remove(tab.id).catch(() => {});

  if (runtimeState.activeTabId === tab.id) {
    runtimeState.activeTabId = null;
    runtimeState.activeUrl = '';
    runtimeState.currentEventStart = null;
  }

  return true;
}

// Get limits configuration
async function getLimits() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.LIMITS, STORAGE_KEYS.SETTINGS]);
  return data[STORAGE_KEYS.LIMITS]
    || data[STORAGE_KEYS.SETTINGS]?.categoryLimitsMinutes
    || DEFAULT_SETTINGS.categoryLimitsMinutes;
}

// Get alerts already shown today
async function getAlertsShown() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.ALERTS_SHOWN);
  const alertsShown = data[STORAGE_KEYS.ALERTS_SHOWN] || {};
  
  // Clean up old alerts (older than today)
  const today = new Date().toISOString().split('T')[0];
  for (const key of Object.keys(alertsShown)) {
    if (!key.startsWith(today)) {
      delete alertsShown[key];
    }
  }
  
  return alertsShown;
}

// Block category by sending message to content script
async function blockCategory(category) {
  const tabs = await chrome.tabs.query({});
  
  for (const tab of tabs) {
    if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      continue;
    }
    
    const domain = new URL(tab.url).hostname;
    const categories = await getCategories();
    const tabCategory = getCategoryForDomain(domain, categories);
    
    if (tabCategory === category) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'blockPage'
        });
      } catch (error) {
        // Tab may not support content script (e.g., system pages)
      }
    }
  }
}

// Show notification
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: title,
    message: message,
    priority: 2
  });
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

// Handle messages from content scripts and popup/dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const type = request?.type;
    const action = request?.action;

    if (type === 'youtubeVideoChanged') {
      const tabId = sender?.tab?.id;
      sendResponse(await handleYoutubeVideoChanged(request, tabId));
      return;
    }

    if (type === 'youtubeShiftAllowOnce') {
      const tabId = sender?.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'Missing tab context' });
        return;
      }
      await markYoutubeShiftCooldown(tabId, request?.seconds);
      sendResponse({ ok: true });
      return;
    }

    if (type === 'youtubePlaybackSignal') {
      const tabId = sender?.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'Missing tab context' });
        return;
      }

      const isPlaying = !!request?.isPlaying;
      if (isPlaying) {
        runtimeState.youtubePlaybackTabId = tabId;
        runtimeState.youtubePlaybackActiveUntil = Date.now() + 15000;

        if (runtimeState.activeTabId === tabId && runtimeState.isIdle) {
          runtimeState.isIdle = false;
          runtimeState.idleReason = 'video-playing';
          runtimeState.currentEventStart = Date.now();
          runtimeState.lastHeartbeatTime = Date.now();
        }
      } else if (runtimeState.youtubePlaybackTabId === tabId) {
        runtimeState.youtubePlaybackActiveUntil = 0;
      }

      sendResponse({ ok: true });
      return;
    }

    if (type === 'shortsSessionStart') {
      const tabId = sender?.tab?.id;
      sendResponse(await handleShortsSessionStart(tabId, request?.shortId));
      return;
    }

    if (type === 'shortsSessionTick') {
      const tabId = sender?.tab?.id;
      const isActive = !!request?.active;
      sendResponse(await handleShortsSessionTick(tabId, isActive, request?.shortId));
      return;
    }

    if (type === 'shortsSessionEnd') {
      const tabId = sender?.tab?.id;
      sendResponse(await handleShortsSessionEnd(tabId));
      return;
    }

    if (type === 'getRuntimeDebugState') {
      const systemIdleState = await getSystemIdleState();
      const playbackOverride = hasActiveYoutubePlaybackOverride();
      sendResponse({
        ok: true,
        systemIdleState,
        playbackOverride,
        isIdle: !playbackOverride && (runtimeState.isIdle || systemIdleState !== 'active'),
        idleReason: playbackOverride
          ? 'video-playing'
          : (systemIdleState !== 'active' ? systemIdleState : runtimeState.idleReason),
        activeTabId: runtimeState.activeTabId,
        activeUrl: runtimeState.activeUrl,
        now: Date.now()
      });
      return;
    }

    if (type === 'getSnapshot') {
      sendResponse(await buildSnapshot());
      return;
    }

    if (type === 'saveSettings') {
      const settings = normalizeSettings(request.settings || {});
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: settings,
        [STORAGE_KEYS.CATEGORIES]: settings.categories,
        [STORAGE_KEYS.LIMITS]: settings.categoryLimitsMinutes
      });
      sendResponse({ ok: true });
      return;
    }

    if (type === 'saveFocusSettings') {
      const next = normalizeFocusSettings(request.settings || {});
      await chrome.storage.sync.set(next);
      sendResponse({ ok: true });
      return;
    }

    if (type === 'getAiInsights') {
      const snapshot = await buildSnapshot();
      const settings = normalizeSettings(snapshot.settings);
      const text = await requestAiInsights(snapshot, settings);
      await chrome.storage.local.set({ [STORAGE_KEYS.LATEST_AI_INSIGHT]: text });
      sendResponse({ ok: true, text });
      return;
    }

    if (type === 'export') {
      const snapshot = await buildSnapshot();
      if (request.format === 'csv') {
        sendResponse({ filename: 'productivity-data.csv', content: toCsv(snapshot) });
      } else {
        sendResponse({ filename: 'productivity-data.json', content: JSON.stringify(snapshot, null, 2) });
      }
      return;
    }

    if (type === 'clearAllData') {
      await chrome.storage.local.set({
        [STORAGE_KEYS.DAILY_USAGE]: {},
        [STORAGE_KEYS.ALERTS_SHOWN]: {},
        [STORAGE_KEYS.LATEST_AI_INSIGHT]: ''
      });
      sendResponse({ ok: true });
      return;
    }

    if (action === 'getDailyUsage') {
      const data = await chrome.storage.local.get(STORAGE_KEYS.DAILY_USAGE);
      sendResponse(data[STORAGE_KEYS.DAILY_USAGE] || {});
      return;
    }

    if (action === 'getSettings') {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.LIMITS,
        STORAGE_KEYS.CATEGORIES,
        STORAGE_KEYS.SETTINGS
      ]);
      sendResponse({
        limits: data[STORAGE_KEYS.LIMITS],
        categories: data[STORAGE_KEYS.CATEGORIES],
        settings: data[STORAGE_KEYS.SETTINGS]
      });
      return;
    }

    if (action === 'saveLimits') {
      await chrome.storage.local.set({ [STORAGE_KEYS.LIMITS]: request.limits || {} });
      sendResponse({ success: true });
      return;
    }

    if (action === 'saveCategories') {
      await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: request.categories || {} });
      sendResponse({ success: true });
      return;
    }

    if (action === 'saveSettings') {
      const settings = normalizeSettings(request.settings || {});
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
      sendResponse({ success: true });
      return;
    }

    if (action === 'clearData') {
      await chrome.storage.local.set({
        [STORAGE_KEYS.DAILY_USAGE]: {},
        [STORAGE_KEYS.ALERTS_SHOWN]: {}
      });
      sendResponse({ success: true });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });

  return true;
});

// ============================================================================
// STARTUP & SHUTDOWN
// ============================================================================

// Initialize when service worker starts
initializeActiveTab().then(() => {
  ensureDefaults().catch(() => {});
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  startHeartbeat();
});

// Clean up on shutdown
chrome.runtime.onSuspend.addListener(() => {
  stopHeartbeat();
});
