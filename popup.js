function fmtSeconds(seconds) {
	const mins = Math.floor(seconds / 60);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h <= 0) return `${m}m`;
	return `${h}h ${m}m`;
}

function sum(obj) {
	return Object.values(obj || {}).reduce((acc, n) => acc + n, 0);
}

function topEntries(obj, count) {
	return Object.entries(obj || {})
		.sort((a, b) => b[1] - a[1])
		.slice(0, count);
}

async function getSnapshot() {
	return chrome.runtime.sendMessage({ type: "getSnapshot" });
}

function render(snapshot) {
	const dateEl = document.getElementById("todayDate");
	const totalEl = document.getElementById("totalTime");
	const productiveEl = document.getElementById("productiveTime");
	const distractingEl = document.getElementById("distractingTime");
	const topSitesEl = document.getElementById("topSites");
	const statusEl = document.getElementById("status");

	dateEl.textContent = new Date().toLocaleDateString();

	const today = snapshot?.today || {};
	const total = today.totalSeconds || 0;
	const categories = today.categories || {};
	const productive = (categories.Productive || 0) + (categories.Learning || 0);
	const distracting = (categories.Entertainment || 0) + (categories.Social || 0);

	totalEl.textContent = fmtSeconds(total);
	productiveEl.textContent = fmtSeconds(productive);
	distractingEl.textContent = fmtSeconds(distracting);

	const topSites = topEntries(today.domains, 5);
	topSitesEl.innerHTML = "";
	if (!topSites.length) {
		const li = document.createElement("li");
		li.textContent = "No activity yet";
		topSitesEl.appendChild(li);
	} else {
		topSites.forEach(([domain, seconds]) => {
			const li = document.createElement("li");
			const left = document.createElement("span");
			left.className = "domain";
			left.textContent = domain;
			const right = document.createElement("span");
			right.textContent = fmtSeconds(seconds);
			li.appendChild(left);
			li.appendChild(right);
			topSitesEl.appendChild(li);
		});
	}

	const limits = snapshot?.limitsStatus || [];
	const hit = limits.filter((x) => x.overLimit).length;
	statusEl.textContent = hit > 0 ? `${hit} limit(s) reached today` : "Within limits";
}

async function refresh() {
	const snapshot = await getSnapshot();
	render(snapshot);
}

document.getElementById("refreshBtn").addEventListener("click", refresh);

document.getElementById("openDashboard").addEventListener("click", async () => {
	try {
		await chrome.runtime.openOptionsPage();
		window.close();
	} catch (error) {
		console.error("Failed to open dashboard:", error);
	}
});

chrome.runtime.onMessage.addListener((message) => {
	if (message?.type === "statsUpdated") {
		refresh();
	}
});

refresh();