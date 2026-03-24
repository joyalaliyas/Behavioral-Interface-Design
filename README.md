# Behavioral-Interface-Design

Chrome extension project focused on reducing digital distraction using behavior-aware UI interventions, active-time tracking, and configurable enforcement policies.

## What This Project Does

This extension combines three layers:

1. Tracking layer
- Measures active browsing time by domain and category.
- Handles idle/away/unfocused states to avoid inflated time counts.
- Surfaces daily and weekly usage snapshots.

2. Focus-intervention layer
- Applies YouTube UI modifications (hide recommendations, hide likes/comments, blur thumbnails).
- Detects doom-scroll patterns and responds with guard behavior.
- Adds contextual overlays for YouTube-specific guardrails.

3. Enforcement layer
- Category/domain limits with optional notifications and tab close.
- YouTube context-shift guard (warn/block on distracting transitions).
- YouTube Shorts timer policy with daily lock behavior.

## Current Feature Set

### Core Productivity Tracking
- Active-time tracking for open browsing tabs.
- Domain and category aggregation.
- Daily and weekly summaries.
- Export data as CSV or JSON.

### Limits and Alerts
- Category limits (for example: Entertainment=60).
- Domain limits (for example: youtube.com=60).
- Optional alert notifications when limits are reached.
- Optional close-tab behavior after limit reached.

### YouTube Focus Controls
- Blur thumbnails.
- Hide recommendations.
- Hide likes.
- Hide comments.
- Doom-scroll detector with warning and trigger scoring.

### YouTube Context-Shift Guard
- Detects transition patterns such as Learning -> Entertainment.
- Supports heuristic + AI classification path.
- Configurable warning duration, block duration, cooldown, severity threshold, and monitored transitions.

### YouTube Shorts Guard
- Configurable Shorts time limit in settings.
- Daily lock for the day after limit hit.
- Setting supports special value: 0 minutes = no Shorts usage (immediate block).
- Block overlay with a single Go back action.

### Debug Aids
- Runtime idle debug indicator.
- Shorts timer debug pill.
- YouTube shift debug payload panel hooks.

## Project Structure

- [manifest.json](manifest.json): Chrome extension manifest (MV3), permissions, entry points.
- [background.js](background.js): service worker; source of truth for tracking, settings, limits, AI logic, and Shorts/session policies.
- [content.js](content.js): YouTube content script; DOM interventions, overlays, Shorts/watch detection, messaging.
- [idle-debug-pill.js](idle-debug-pill.js): all-sites debug pill script.
- [popup.html](popup.html), [popup.js](popup.js): compact daily summary popup.
- [dashboard.html](dashboard.html), [dashboard.js](dashboard.js): dashboard visualizations and insights screen.
- [settings.html](settings.html), [settings.js](settings.js): settings UI and persistence wiring.
- [hackthon ideas.md](hackthon ideas.md): ideation notes.

## Permissions Used

From [manifest.json](manifest.json):

- tabs: read active tab context for tracking/enforcement.
- windows: focus-state tracking.
- storage: persist settings and usage history.
- idle: detect system idle/active transitions.
- notifications: limit alerts.
- alarms: periodic scheduling hooks.
- host_permissions <all_urls>: tracking and debug content script coverage.

## Installation (Developer Mode)

1. Open Chrome and go to chrome://extensions.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project folder.
5. Pin the extension from the toolbar if desired.

## Usage Guide

### Popup
1. Click extension icon.
2. View Today summary and top sites.
3. Open dashboard for deeper analytics.

### Dashboard
1. Open dashboard from popup.
2. Review KPIs, top sites, category split, limits table.
3. Generate AI insights (if enabled/configured).

### Settings
1. Open settings from dashboard.
2. Configure categories and limits.
3. Configure YouTube controls and Shorts timer.
4. Configure AI provider and model.
5. Configure YouTube context-shift guard.
6. Save settings.

## Key Settings Reference

### Categories and Limits
- Productive/Learning/Entertainment/Social domain lists.
- Category limits map: one per line, example Entertainment=60.
- Domain limits map: one per line, example youtube.com=60.
- Alerts enabled toggle.
- Block tab after limit toggle.

### YouTube Focus Controls
- Blur thumbnails toggle.
- Hide recommendations toggle.
- Hide likes toggle.
- Hide comments toggle.
- Doom-scroll detector toggle.
- Doom cooldown seconds.
- Doom warning score and trigger score.
- Shorts block timer in minutes.
	- 0 means no usage (Shorts blocked immediately).

### AI Provider
- Enable AI insights toggle.
- Provider selection: OpenAI / Gemini / DeepSeek.
- Provider model selection.
- API key and system prompt.

### YouTube Context-Shift Guard
- Enable guard toggle.
- Enable AI classification toggle.
- Warn countdown seconds.
- Block duration seconds.
- Allow-once cooldown seconds.
- Severity threshold (low/medium/high).
- Monitored transition pairs.

## Data and Storage

The extension stores data in Chrome storage:

- Usage buckets (daily domain/category totals).
- Settings object.
- Categories and limits.
- Alert state.
- YouTube context state and history.
- Daily Shorts lock map.

No external backend is required for core tracking features.

## AI Integration Notes

AI is optional. If enabled, endpoint/model selection is configurable in settings.

- OpenAI-compatible request format is used.
- Gemini and DeepSeek are supported via configured endpoints.
- API key is stored in extension local settings storage.

## Development Workflow

### Make code changes
1. Edit files in this workspace.
2. Reload extension from chrome://extensions.
3. Refresh target pages (especially YouTube) to reload content scripts.

### Git workflow
1. `git status`
2. `git add .`
3. `git commit -m "your message"`
4. `git push`

## Troubleshooting

### Settings changed but behavior did not update
- Save settings and reload extension from chrome://extensions.
- Refresh affected pages (YouTube tabs need reload for content script changes).

### Shorts policy not applying as expected
- Confirm Shorts timer value in settings.
- If value is 0, Shorts should block immediately.
- If value > 0, verify whether daily lock has already been set for current day.

### Push to GitHub fails with permission denied
- Verify authenticated GitHub account has write permission.
- Clear cached wrong credentials and authenticate with correct account.

## Security and Privacy

- Data is stored in browser extension storage.
- No server component is required for basic tracking and enforcement.
- API keys are user-provided and stored locally in extension settings.

## License

This repository includes a license file: [LICENSE](LICENSE).

## Roadmap Ideas

- Add onboarding flow and first-run profile templates.
- Add richer dashboard trends (week-over-week, category drift).
- Add strict mode variants for Shorts and context-shift policies.
- Add granular per-site intervention presets.
