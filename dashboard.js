function fmtSeconds(seconds) {
  const mins = Math.floor((seconds || 0) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function toPercent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function entriesSorted(obj, n) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderDomainBars(today) {
  const parent = document.getElementById("domainBars");
  parent.innerHTML = "";
  const top = entriesSorted(today.domains, 8);
  const max = top.length ? top[0][1] : 1;

  if (!top.length) {
    const p = document.createElement("div");
    p.textContent = "No tracked activity yet.";
    p.style.color = "#66758a";
    p.style.fontSize = "13px";
    parent.appendChild(p);
    return;
  }

  top.forEach(([name, sec]) => {
    const row = document.createElement("div");
    row.className = "barRow";

    const label = document.createElement("div");
    label.textContent = name;

    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = `${Math.max(4, Math.round((sec / max) * 100))}%`;
    track.appendChild(fill);

    const val = document.createElement("div");
    val.textContent = fmtSeconds(sec);

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(val);
    parent.appendChild(row);
  });
}

function renderCategoryPie(today) {
  const pie = document.getElementById("categoryPie");
  const legend = document.getElementById("categoryLegend");
  legend.innerHTML = "";

  const categories = today.categories || {};
  const mapping = [
    { key: "Productive", color: "#1d4ed8" },
    { key: "Learning", color: "#0891b2" },
    { key: "Entertainment", color: "#f59e0b" },
    { key: "Social", color: "#dc2626" },
    { key: "Other", color: "#6b7280" }
  ];

  const total = Object.values(categories).reduce((a, b) => a + b, 0);
  if (!total) {
    pie.style.background = "#e7edf8";
    legend.textContent = "No category data yet";
    return;
  }

  let start = 0;
  const chunks = [];

  mapping.forEach(({ key, color }) => {
    const value = categories[key] || 0;
    if (!value) return;
    const pct = (value / total) * 100;
    const end = start + pct;
    chunks.push(`${color} ${start}% ${end}%`);
    start = end;

    const line = document.createElement("div");
    line.innerHTML = `<span class="dot" style="background:${color}"></span>${key}: ${toPercent(value, total)}% (${fmtSeconds(value)})`;
    legend.appendChild(line);
  });

  pie.style.background = `conic-gradient(${chunks.join(",")})`;
}

function parseAiSections(aiText) {
  const lines = String(aiText || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const sections = [];
  let current = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\d+[\)\.]?\s*\*{0,2}([^:*]+)\*{0,2}:?\s*(.*)$/);
    if (sectionMatch) {
      current = {
        title: sectionMatch[1].trim(),
        body: sectionMatch[2].trim(),
        bullets: []
      };
      sections.push(current);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch && current) {
      current.bullets.push(bulletMatch[1].replace(/\*\*/g, "").trim());
      continue;
    }

    if (current) {
      if (current.body) {
        current.body += ` ${line.replace(/\*\*/g, "").trim()}`;
      } else {
        current.body = line.replace(/\*\*/g, "").trim();
      }
      continue;
    }

    sections.push({ title: "Insight", body: line.replace(/\*\*/g, "").trim(), bullets: [] });
  }

  return sections;
}

function renderInsights(insights, aiInsight) {
  const ul = document.getElementById("insights");
  ul.innerHTML = "";

  (insights || []).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  });

  if (!String(aiInsight || "").trim()) {
    return;
  }

  const aiRoot = document.createElement("li");
  aiRoot.innerHTML = "<strong>AI insight</strong>";

  const sections = parseAiSections(aiInsight);
  if (!sections.length) {
    const text = document.createElement("div");
    text.textContent = String(aiInsight).trim();
    aiRoot.appendChild(text);
    ul.appendChild(aiRoot);
    return;
  }

  const sectionList = document.createElement("ol");
  sections.forEach((section) => {
    const sectionItem = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = section.title;
    sectionItem.appendChild(title);

    if (section.body) {
      const body = document.createElement("span");
      body.textContent = `: ${section.body}`;
      sectionItem.appendChild(body);
    }

    if (section.bullets.length) {
      const bullets = document.createElement("ul");
      section.bullets.forEach((line) => {
        const bullet = document.createElement("li");
        bullet.textContent = line;
        bullets.appendChild(bullet);
      });
      sectionItem.appendChild(bullets);
    }

    sectionList.appendChild(sectionItem);
  });

  aiRoot.appendChild(sectionList);
  ul.appendChild(aiRoot);
}

function renderLimits(rows) {
  const tbody = document.getElementById("limitsTable");
  tbody.innerHTML = "";
  if (!rows || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan='4'>No limits configured.</td>";
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.label}</td>
      <td>${fmtSeconds(row.used)}</td>
      <td>${fmtSeconds(row.max)}</td>
      <td class="${row.overLimit ? "over" : ""}">${row.overLimit ? "Exceeded" : "OK"}</td>
    `;
    tbody.appendChild(tr);
  });
}

let snapshotCache = null;

async function refresh() {
  const snapshot = await chrome.runtime.sendMessage({ type: "getSnapshot" });
  snapshotCache = snapshot;

  const today = snapshot.today || {};
  const week = snapshot.week || {};
  const categories = today.categories || {};

  const productive = (categories.Productive || 0) + (categories.Learning || 0);
  const distracting = (categories.Entertainment || 0) + (categories.Social || 0);

  document.getElementById("dateLabel").textContent = new Date().toLocaleString();
  setText("kpiTotal", fmtSeconds(today.totalSeconds || 0));
  setText("kpiProductive", fmtSeconds(productive));
  setText("kpiDistracting", fmtSeconds(distracting));
  setText("kpiWeek", fmtSeconds(week.totalSeconds || 0));

  renderDomainBars(today);
  renderCategoryPie(today);
  renderInsights(snapshot.insights || [], snapshot.aiInsight || "");
  renderLimits(snapshot.limitsStatus || []);
}

document.getElementById("refresh").addEventListener("click", refresh);

document.getElementById("openSettings").addEventListener("click", () => {
  window.location.href = "settings.html";
});

document.getElementById("generateAiInsights").addEventListener("click", async () => {
  const button = document.getElementById("generateAiInsights");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Generating...";

  const res = await chrome.runtime.sendMessage({ type: "getAiInsights" });
  button.disabled = false;
  button.textContent = oldText;

  if (res?.ok) {
    await refresh();
    return;
  }

  const ul = document.getElementById("insights");
  const li = document.createElement("li");
  li.textContent = `AI insights failed: ${res?.error || "unknown error"}`;
  ul.appendChild(li);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "statsUpdated") {
    refresh();
  }
});

refresh();
