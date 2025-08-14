const hasExtensionContext = () => {
try {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
} catch {
  return false;
}
};

let destroyed = false;

console.log('Keka Extension: Script loaded');

let widgetHTML = '';
let widgetData = null;

// Utilities
function getHoursAndMinutesFromMilliseconds(milliseconds) {
const totalMinutes = Math.floor(milliseconds / (1000 * 60));
const hours = Math.floor(totalMinutes / 60);
const minutes = totalMinutes % 60;
return { hours, minutes };
}

function formatTimeWithTZ(date) {
try {
  // Local time, 12-hour clock, no timezone suffix
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return fmt.format(date); // e.g., "3:12 PM"
} catch {
  // Fallback without TZ label
  const h24 = date.getHours();
  const h = h24 % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}
}

function clamp(val, min, max) {
return Math.min(Math.max(val, min), max);
}

// Compute ETA/Reached info without timezone label
function computeCompletionInfo(eh, em, lastEntryISO, targetHours) {
const total = eh * 60 + em;
const target = targetHours * 60;
if (!lastEntryISO) {
  return { text: 'Not available', reached: false, reachedAtIso: null, reachedAtTz: null, etaIso: null, etaTz: null };
}

const last = new Date(lastEntryISO);
if (total >= target) {
  const over = total - target;
  const reachedAt = new Date(last.getTime() - over * 60 * 1000);
  return {
    text: 'Reached',
    reached: true,
    reachedAtIso: reachedAt.toISOString(),
    reachedAtTz: formatTimeWithTZ(reachedAt),
    etaIso: null,
    etaTz: null,
  };
} else {
  const remaining = target - total;
  const eta = new Date(last.getTime() + remaining * 60 * 1000);
  return {
    text: formatTimeWithTZ(eta),
    reached: false,
    reachedAtIso: null,
    reachedAtTz: null,
    etaIso: eta.toISOString(),
    etaTz: formatTimeWithTZ(eta),
  };
}
}

// Fetch and compute daily data
async function getDailyData() {
try {
  const authToken = localStorage.getItem('access_token');
  if (!authToken) {
    return {
      effective: { h: 0, m: 0 },
      gross: { h: 0, m: 0 },
      breakTime: { h: 0, m: 0 },
      completion: { '4h': 'Please login', '6h': 'Please login', '8h': 'Please login' },
      completionInfo: null,
      lastLogOfTheDay: null,
      status: 'No token',
    };
  }

  const url = 'https://techahead.keka.com/k/attendance/api/mytime/attendance/summary/';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return {
      effective: { h: 0, m: 0 },
      gross: { h: 0, m: 0 },
      breakTime: { h: 0, m: 0 },
      completion: { '4h': `${response.status}`, '6h': `${response.status}`, '8h': `${response.status}` },
      completionInfo: null,
      lastLogOfTheDay: null,
      status: 'API Error',
    };
  }

  const payload = await response.json();
  const logs = payload.data || [];
  const today = new Date().toISOString().split('T')[0];

  const todayLog = logs.find((log) => (log.attendanceDate || '').startsWith(today));
  if (!todayLog) {
    return {
      effective: { h: 0, m: 0 },
      gross: { h: 0, m: 0 },
      breakTime: { h: 0, m: 0 },
      completion: { '4h': 'Not found', '6h': 'Not found', '8h': 'Not found' },
      completionInfo: null,
      lastLogOfTheDay: null,
      status: 'No today',
    };
  }

  // Extract effective hours
  let effectiveHours = 0;
  let effectiveMinutes = 0;
  const effectiveFields = [
    'effectiveHoursInHHMM',
    'effectiveHours',
    'effective_hours',
    'effectiveTime',
    'effective_time',
    'productiveHours',
    'productive_hours',
  ];
  let foundEffectiveField = null;
  for (const field of effectiveFields) {
    if (todayLog[field]) {
      foundEffectiveField = field;
      const val = todayLog[field];
      if (typeof val === 'string') {
        const match = val.match(/(\d+)h\s+(\d+)m/);
        if (match) {
          effectiveHours = parseInt(match[1]);
          effectiveMinutes = parseInt(match[2]);
        }
      } else if (typeof val === 'number') {
        const mins = Math.max(0, val);
        effectiveHours = Math.floor(mins / 60);
        effectiveMinutes = mins % 60;
      }
      break;
    }
  }

  // Fallback: derive from first/last log
  if (!foundEffectiveField && todayLog.firstLogOfTheDay && todayLog.lastLogOfTheDay) {
    const startTime = new Date(todayLog.firstLogOfTheDay).getTime();
    const endTime = new Date(todayLog.lastLogOfTheDay).getTime();
    if (!isNaN(startTime) && !isNaN(endTime) && endTime > startTime) {
      const diff = endTime - startTime;
      const { hours, minutes } = getHoursAndMinutesFromMilliseconds(diff);
      effectiveHours = hours;
      effectiveMinutes = minutes;
    }
  }

  // Extract gross hours
  let grossHours = 0;
  let grossMinutes = 0;
  const grossFields = ['grossHoursInHHMM', 'grossHours', 'gross_hours', 'totalHours', 'total_hours'];
  for (const field of grossFields) {
    if (todayLog[field]) {
      const val = todayLog[field];
      if (typeof val === 'string') {
        const match = val.match(/(\d+)h\s+(\d+)m/);
        if (match) {
          grossHours = parseInt(match[1]);
          grossMinutes = parseInt(match[2]);
        }
      } else if (typeof val === 'number') {
        const mins = Math.max(0, val);
        grossHours = Math.floor(mins / 60);
        grossMinutes = mins % 60;
      }
      break;
    }
  }

  const grossTotal = grossHours * 60 + grossMinutes;
  const effectiveTotal = effectiveHours * 60 + effectiveMinutes;
  const breakMinutes = Math.max(0, grossTotal - effectiveTotal);
  const breakH = Math.floor(breakMinutes / 60);
  const breakM = breakMinutes % 60;

  const lastLog = todayLog.lastLogOfTheDay || null;

  // TZ-aware completion info (without TZ suffix)
  const info4 = computeCompletionInfo(effectiveHours, effectiveMinutes, lastLog, 4);
  const info6 = computeCompletionInfo(effectiveHours, effectiveMinutes, lastLog, 6);
  const info8 = computeCompletionInfo(effectiveHours, effectiveMinutes, lastLog, 8);

  return {
    effective: { h: effectiveHours, m: effectiveMinutes },
    gross: { h: grossHours, m: grossMinutes },
    breakTime: { h: breakH, m: breakM },
    completion: { '4h': info4.text, '6h': info6.text, '8h': info8.text },
    completionInfo: { '4h': info4, '6h': info6, '8h': info8 },
    lastLogOfTheDay: lastLog,
    status: 'ok',
  };
} catch (error) {
  console.error('getDailyData error:', error);
  return {
    effective: { h: 0, m: 0 },
    gross: { h: 0, m: 0 },
    breakTime: { h: 0, m: 0 },
    completion: { '4h': 'Error', '6h': 'Error', '8h': 'Error' },
    completionInfo: null,
    lastLogOfTheDay: null,
    status: 'Error',
  };
}
}

// Build widget HTML
function buildWidgetHTML(data) {
const eff = `${data.effective.h}h ${data.effective.m}m`;
const brk = `${data.breakTime.h}h ${data.breakTime.m}m`;
const c4 = data.completion['4h'];
const c6 = data.completion['6h'];
const c8 = data.completion['8h'];

const isReached = (v) => typeof v === 'string' && v.toLowerCase() === 'reached';
const progress = clamp(
  Math.round(((data.effective.h * 60 + data.effective.m) / (8 * 60)) * 100),
  0,
  100
);

const info4 = data.completionInfo?.['4h'];
const info6 = data.completionInfo?.['6h'];
const info8 = data.completionInfo?.['8h'];

const c4Class = `kw-time ${isReached(c4) ? 'kw-pill kw-reached' : ''}`;
const c6Class = `kw-time ${isReached(c6) ? 'kw-pill kw-reached' : ''}`;
const c8Class = `kw-time ${isReached(c8) ? 'kw-pill kw-reached' : ''}`;

const c4Title = isReached(c4)
  ? `Reached at ${info4?.reachedAtTz ?? ''}`
  : info4?.etaTz
  ? `Estimated ${info4.etaTz}`
  : '';
const c6Title = isReached(c6)
  ? `Reached at ${info6?.reachedAtTz ?? ''}`
  : info6?.etaTz
  ? `Estimated ${info6.etaTz}`
  : '';
const c8Title = isReached(c8)
  ? `Reached at ${info8?.reachedAtTz ?? ''}`
  : info8?.etaTz
  ? `Estimated ${info8.etaTz}`
  : '';

return `
  <div class="kw-card" role="region" aria-label="Keka hours summary">
    <div class="kw-header" role="button" aria-label="Toggle minimize" title="Click to minimize/expand">
      <div class="kw-title">Keka Hours</div>
    </div>

    <div class="kw-body">
      <div class="kw-top">
        <div class="kw-metric">
          <div class="kw-label">Hours Completed</div>
          <div class="kw-value">${eff}</div>
        </div>
        <div class="kw-metric">
          <div class="kw-label">Break Time</div>
          <div class="kw-value">${brk}</div>
        </div>
      </div>

      <div class="kw-progress" aria-label="Progress toward 8 hours" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
        <div class="kw-progress-bar" style="width: ${progress}%"></div>
      </div>

      <div class="kw-targets">
        <div class="kw-target">
          <span class="kw-target-label">4h Complete</span>
          <span class="${c4Class}" title="${c4Title}">${c4}</span>
        </div>
        <div class="kw-target">
          <span class="kw-target-label">6h Complete</span>
          <span class="${c6Class}" title="${c6Title}">${c6}</span>
        </div>
        <div class="kw-target">
          <span class="kw-target-label">8h Complete</span>
          <span class="${c8Class}" title="${c8Title}">${c8}</span>
        </div>
      </div>
    </div>
  </div>
`;
}

function injectWidgetStyles() {
if (document.getElementById('keka-widget-styles')) return;

const style = document.createElement('style');
style.id = 'keka-widget-styles';
style.textContent = `
  :root {
    --kw-bg: #f5efe6;       /* beige */
    --kw-panel: #f3e9dc;    /* light sand */
    --kw-text: #3e2f23;     /* dark brown */
    --kw-muted: #8b6b4a;    /* medium brown */
    --kw-accent: #a47148;   /* accent brown */
    --kw-border: #d8c3a5;   /* border beige */
    --kw-shadow: 0 8px 20px rgba(62, 47, 35, 0.2);
  }

  #keka-widget {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 999999;
    color: var(--kw-text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  }

  #keka-widget .kw-card {
    background: var(--kw-panel);
    border: 1px solid var(--kw-border);
    border-radius: 12px;
    min-width: 280px;
    max-width: 360px;
    box-shadow: var(--kw-shadow);
    overflow: hidden;
  }

  #keka-widget .kw-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--kw-bg);
    border-bottom: 1px solid var(--kw-border);
    cursor: pointer;
    user-select: none;
  }

  #keka-widget .kw-card.minimized .kw-header {
    border-bottom: none;
    border-radius: 12px;
  }

  #keka-widget .kw-card.minimized .kw-body {
    display: none;
  }

  #keka-widget .kw-title {
    font-weight: 700;
    letter-spacing: 0.2px;
    color: var(--kw-text);
  }

  #keka-widget .kw-body {
    padding: 12px;
  }

  #keka-widget .kw-top {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  #keka-widget .kw-metric {
    background: #fffaf3;
    border: 1px solid var(--kw-border);
    border-radius: 10px;
    padding: 10px;
  }

  #keka-widget .kw-label {
    font-size: 12px;
    color: var(--kw-muted);
    margin-bottom: 2px;
  }

  #keka-widget .kw-value {
    font-size: 16px;
    font-weight: 700;
    color: var(--kw-text);
  }

  #keka-widget .kw-progress {
    height: 8px;
    background: #efe4d4;
    border: 1px solid var(--kw-border);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 12px;
  }

  #keka-widget .kw-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--kw-accent), #8d5a3b);
    width: 0%;
    transition: width 300ms ease;
  }

  #keka-widget .kw-targets {
    display: grid;
    gap: 8px;
  }

  #keka-widget .kw-target {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fffaf3;
    border: 1px solid var(--kw-border);
    border-radius: 10px;
    padding: 8px 10px;
  }

  #keka-widget .kw-target-label {
    font-weight: 600;
    color: var(--kw-text);
  }

  #keka-widget .kw-time {
    color: var(--kw-accent);
    font-weight: 700;
  }

  /* Pill styles for reached status */
  #keka-widget .kw-pill {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--kw-border);
    background: var(--kw-bg);
    display: inline-block;
  }

  #keka-widget .kw-reached {
    border-color: var(--kw-accent);
    color: var(--kw-accent);
    background: #faefe4;
  }
`;
document.head.appendChild(style);
}

// Minimize state
async function applyMinimizedState() {
const { widgetMinimized } = hasExtensionContext()
  ? await chrome.storage.local.get(['widgetMinimized'])
  : { widgetMinimized: false };
const card = document.querySelector('#keka-widget .kw-card');
if (card) {
  if (widgetMinimized) card.classList.add('minimized');
  else card.classList.remove('minimized');
}
}

function wireMinimizeToggle() {
const header = document.querySelector('#keka-widget .kw-header');
if (!header) return;
header.addEventListener('click', async (e) => {
  e.preventDefault();
  const card = document.querySelector('#keka-widget .kw-card');
  if (!card) return;
  const willMinimize = !card.classList.contains('minimized');
  card.classList.toggle('minimized', willMinimize);
  if (hasExtensionContext()) {
    await chrome.storage.local.set({ widgetMinimized: willMinimize });
  }
});
}

function addWidgetToPage() {
removeWidgetFromPage();
injectWidgetStyles();
const wrapper = document.createElement('div');
wrapper.id = 'keka-widget';
wrapper.innerHTML = widgetHTML;
document.body.appendChild(wrapper);

// Restore minimized state and wire click
applyMinimizedState().then(() => {
  wireMinimizeToggle();
});
}

function removeWidgetFromPage() {
const existing = document.getElementById('keka-widget');
if (existing) existing.remove();
}

let refreshIntervalId = null;

function startAutoRefresh() {
if (refreshIntervalId) return;
refreshIntervalId = setInterval(() => {
  const onLogs = location.href.includes('#/me/attendance/logs');
  if (onLogs && document.visibilityState === 'visible') {
    renderData();
  }
}, 20000); // refresh every 20s
}

function stopAutoRefresh() {
if (refreshIntervalId) {
  clearInterval(refreshIntervalId);
  refreshIntervalId = null;
}
}

document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'visible' && location.href.includes('#/me/attendance/logs')) {
  renderData();
}
});

// Main flow
async function renderData() {
if (destroyed) return;
try {
  const data = await getDailyData();
  widgetData = data;
  widgetHTML = buildWidgetHTML(data);

  // Persist for popup (guarded)
  if (hasExtensionContext() && chrome.storage?.local?.set) {
    try {
      chrome.storage.local.set(
        {
          hourDataObj: data,
          hourDataHtml: widgetHTML,
          hourData: `⏰ Hours Completed: ${data.effective.h}h ${data.effective.m}m
🕐 4h Complete: ${data.completion['4h']}
🕕 6h Complete: ${data.completion['6h']}
🕗 8h Complete: ${data.completion['8h']}
☕ Break Time: ${data.breakTime.h}h ${data.breakTime.m}m`,
        },
        () => {}
      );
    } catch (e) {
      console.warn('chrome.storage.local.set failed (context likely invalidated):', e);
    }
  }
} catch (error) {
  console.error('renderData error:', error);
}

addWidgetToPage();
}

// Initialize based on URL
function init() {
const onLogs = location.href.includes('#/me/attendance/logs');
if (onLogs) {
  renderData();
  startAutoRefresh();
} else {
  stopAutoRefresh();
  removeWidgetFromPage();
}
}

// Monitor URL changes
function monitorUrlChanges() {
let lastUrl = location.href;
const checkUrlChange = () => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    const onLogs = currentUrl.includes('#/me/attendance/logs');
    if (onLogs) {
      renderData();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
      removeWidgetFromPage();
    }
  }
};
const observer = new MutationObserver(checkUrlChange);
observer.observe(document, { childList: true, subtree: true });
}

// Refresh on focus when on the logs page
window.addEventListener('focus', () => {
if (location.href.includes('#/me/attendance/logs')) {
  renderData();
}
});

window.addEventListener('pagehide', () => {
destroyed = true;
stopAutoRefresh();
});
window.addEventListener('beforeunload', () => {
destroyed = true;
stopAutoRefresh();
});

console.log('Keka Extension: Starting...');
init();
monitorUrlChanges();
console.log('Keka Extension: Setup complete');
