const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]
  },
  gemini: {
    label: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"]
  },
  deepseek: {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    models: ["deepseek-chat", "deepseek-reasoner"]
  }
};

function cleanDomainList(text) {
  return (text || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function mapToLines(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k}=${Number(v)}`)
    .join("\n");
}

function linesToMap(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("=");
    if (parts.length < 2) continue;
    const key = parts.shift().trim();
    const value = Number(parts.join("=").trim());
    if (!key || !Number.isFinite(value) || value <= 0) continue;
    out[key] = Math.round(value);
  }
  return out;
}

function listToLines(values) {
  return (values || []).map((x) => String(x || "").trim()).filter(Boolean).join("\n");
}

function linesToList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function findProviderFromSettings(ai) {
  if (ai?.provider && AI_PROVIDERS[ai.provider]) return ai.provider;
  const endpoint = String(ai?.endpoint || "").trim();
  const found = Object.entries(AI_PROVIDERS).find(([, p]) => p.endpoint === endpoint);
  if (found) return found[0];
  return "openai";
}

function setProviderOptions(selectedKey) {
  const providerSelect = document.getElementById("aiProvider");
  providerSelect.innerHTML = "";

  for (const [key, provider] of Object.entries(AI_PROVIDERS)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = provider.label;
    option.selected = key === selectedKey;
    providerSelect.appendChild(option);
  }
}

function setModelOptions(providerKey, selectedModel) {
  const modelSelect = document.getElementById("aiModel");
  modelSelect.innerHTML = "";

  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.openai;
  provider.models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    option.selected = model === selectedModel;
    modelSelect.appendChild(option);
  });

  if (!provider.models.includes(modelSelect.value)) {
    modelSelect.value = provider.models[0];
  }

  document.getElementById("aiEndpoint").value = provider.endpoint;
}

function fillSettings(settings) {
  document.getElementById("catProductive").value = (settings.categories?.Productive || []).join(", ");
  document.getElementById("catLearning").value = (settings.categories?.Learning || []).join(", ");
  document.getElementById("catEntertainment").value = (settings.categories?.Entertainment || []).join(", ");
  document.getElementById("catSocial").value = (settings.categories?.Social || []).join(", ");

  document.getElementById("categoryLimitsMap").value = mapToLines(settings.categoryLimitsMinutes || {});
  document.getElementById("domainLimitsMap").value = mapToLines(settings.domainLimitsMinutes || {});

  document.getElementById("alertEnabled").checked = !!settings.alertEnabled;
  document.getElementById("blockAfterLimit").checked = !!settings.blockAfterLimit;
  const shortsSeconds = Number(settings.shortsBlockSeconds ?? 60);
  document.getElementById("shortsBlockSeconds").value = Number.isFinite(shortsSeconds)
    ? Math.max(0, Math.round(shortsSeconds / 60))
    : 1;

  const ai = settings.aiInsights || {};
  const providerKey = findProviderFromSettings(ai);
  setProviderOptions(providerKey);
  setModelOptions(providerKey, ai.model);

  document.getElementById("aiEnabled").checked = !!ai.enabled;
  document.getElementById("aiApiKey").value = ai.apiKey || "";
  document.getElementById("aiSystemPrompt").value = ai.systemPrompt || "";

  const guard = settings.youtubeShiftGuard || {};
  document.getElementById("ytShiftEnabled").checked = guard.enabled !== false;
  document.getElementById("ytShiftAiEnabled").checked = guard.aiEnabled !== false;
  document.getElementById("ytShiftWarnSeconds").value = guard.warnSeconds ?? 5;
  document.getElementById("ytShiftBlockSeconds").value = guard.blockSeconds ?? 30;
  document.getElementById("ytShiftCooldownSeconds").value = guard.cooldownSeconds ?? 120;
  document.getElementById("ytShiftSeverityThreshold").value = guard.severityThreshold || "medium";
  document.getElementById("ytShiftMonitoredPairs").value = listToLines(guard.monitoredPairs || [
    "Learning->Entertainment",
    "Learning->Social",
    "Productive->Entertainment",
    "Productive->Social"
  ]);
}

function fillFocusSettings(settings) {
  const s = settings || {};
  document.getElementById("blurThumbnails").checked = s.blurThumbnails !== false;
  document.getElementById("hideRecommendations").checked = s.hideRecommendations !== false;
  document.getElementById("hideLikes").checked = s.hideLikes !== false;
  document.getElementById("hideComments").checked = s.hideComments !== false;
  document.getElementById("doomEnabled").checked = s.doomEnabled !== false;
  document.getElementById("doomCooldownSeconds").value = s.doomCooldownSeconds ?? 30;
  document.getElementById("doomWarningScore").value = s.doomWarningScore ?? 65;
  document.getElementById("doomTriggerScore").value = s.doomTriggerScore ?? 96;
}

function collectSettings() {
  const providerKey = document.getElementById("aiProvider").value;
  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.openai;

  return {
    categories: {
      Productive: cleanDomainList(document.getElementById("catProductive").value),
      Learning: cleanDomainList(document.getElementById("catLearning").value),
      Entertainment: cleanDomainList(document.getElementById("catEntertainment").value),
      Social: cleanDomainList(document.getElementById("catSocial").value)
    },
    categoryLimitsMinutes: linesToMap(document.getElementById("categoryLimitsMap").value),
    domainLimitsMinutes: linesToMap(document.getElementById("domainLimitsMap").value),
    alertEnabled: document.getElementById("alertEnabled").checked,
    blockAfterLimit: document.getElementById("blockAfterLimit").checked,
    shortsBlockSeconds: (() => {
      const minutes = Number(document.getElementById("shortsBlockSeconds").value);
      if (!Number.isFinite(minutes) || minutes <= 0) return 0;
      return Math.round(minutes * 60);
    })(),
    aiInsights: {
      enabled: document.getElementById("aiEnabled").checked,
      provider: providerKey,
      endpoint: provider.endpoint,
      model: document.getElementById("aiModel").value,
      apiKey: document.getElementById("aiApiKey").value.trim(),
      systemPrompt: document.getElementById("aiSystemPrompt").value.trim()
    },
    youtubeShiftGuard: {
      enabled: document.getElementById("ytShiftEnabled").checked,
      aiEnabled: document.getElementById("ytShiftAiEnabled").checked,
      warnSeconds: Number(document.getElementById("ytShiftWarnSeconds").value || 5),
      blockSeconds: Number(document.getElementById("ytShiftBlockSeconds").value || 30),
      cooldownSeconds: Number(document.getElementById("ytShiftCooldownSeconds").value || 120),
      severityThreshold: document.getElementById("ytShiftSeverityThreshold").value,
      monitoredPairs: linesToList(document.getElementById("ytShiftMonitoredPairs").value)
    }
  };
}

function collectFocusSettings() {
  return {
    blurThumbnails: document.getElementById("blurThumbnails").checked,
    hideRecommendations: document.getElementById("hideRecommendations").checked,
    hideLikes: document.getElementById("hideLikes").checked,
    hideComments: document.getElementById("hideComments").checked,
    doomEnabled: document.getElementById("doomEnabled").checked,
    doomCooldownSeconds: Number(document.getElementById("doomCooldownSeconds").value || 30),
    doomWarningScore: Number(document.getElementById("doomWarningScore").value || 65),
    doomTriggerScore: Number(document.getElementById("doomTriggerScore").value || 96)
  };
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("aiProvider").addEventListener("change", (event) => {
  const providerKey = event.target.value;
  setModelOptions(providerKey, "");
});

document.getElementById("openDashboard").addEventListener("click", () => {
  window.location.href = "dashboard.html";
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  const settings = collectSettings();
  const focusSettings = collectFocusSettings();
  const [resA, resB] = await Promise.all([
    chrome.runtime.sendMessage({ type: "saveSettings", settings }),
    chrome.runtime.sendMessage({ type: "saveFocusSettings", settings: focusSettings })
  ]);

  if (resA?.ok && resB?.ok) {
    setStatus("Settings saved.");
    return;
  }

  setStatus(`Save failed: ${resA?.error || resB?.error || "unknown error"}`);
});

document.getElementById("exportCsv").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "export", format: "csv" });
  if (res?.content) {
    downloadText(res.filename || "productivity-data.csv", res.content);
    setStatus("CSV exported.");
  }
});

document.getElementById("exportJson").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "export", format: "json" });
  if (res?.content) {
    downloadText(res.filename || "productivity-data.json", res.content);
    setStatus("JSON exported.");
  }
});

document.getElementById("clearData").addEventListener("click", async () => {
  const ok = window.confirm("Clear all tracked data?");
  if (!ok) return;
  const res = await chrome.runtime.sendMessage({ type: "clearAllData" });
  if (res?.ok) {
    setStatus("All data cleared.");
  }
});

(async function init() {
  const snapshot = await chrome.runtime.sendMessage({ type: "getSnapshot" });
  fillSettings(snapshot.settings || {});
  fillFocusSettings(snapshot.focusSettings || {});
})();
