function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function renderFromObj(obj) {
  const eff = `${obj.effective.h}h ${obj.effective.m}m`;
  const brk = `${obj.breakTime.h}h ${obj.breakTime.m}m`;
  const c4 = obj.completion['4h'];
  const c6 = obj.completion['6h'];
  const c8 = obj.completion['8h'];

  const info4 = obj.completionInfo?.['4h'];
  const info6 = obj.completionInfo?.['6h'];
  const info8 = obj.completionInfo?.['8h'];

  const isReached = (v) => typeof v === 'string' && v.toLowerCase() === 'reached';
  const c4Title = isReached(c4) ? `Reached at ${info4?.reachedAtTz ?? ''}` : info4?.etaTz ? `Estimated ${info4.etaTz}` : '';
  const c6Title = isReached(c6) ? `Reached at ${info6?.reachedAtTz ?? ''}` : info6?.etaTz ? `Estimated ${info6.etaTz}` : '';
  const c8Title = isReached(c8) ? `Reached at ${info8?.reachedAtTz ?? ''}` : info8?.etaTz ? `Estimated ${info8.etaTz}` : '';

  const progress = clamp(
    Math.round(((obj.effective.h * 60 + obj.effective.m) / (8 * 60)) * 100),
    0,
    100
  );

  const pillClass = (v) => (isReached(v) ? 'kw-time kw-pill kw-reached' : 'kw-time');

  return `
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
        <span class="${pillClass(c4)}" title="${c4Title}">${c4}</span>
      </div>
      <div class="kw-target">
        <span class="kw-target-label">6h Complete</span>
        <span class="${pillClass(c6)}" title="${c6Title}">${c6}</span>
      </div>
      <div class="kw-target">
        <span class="kw-target-label">8h Complete</span>
        <span class="${pillClass(c8)}" title="${c8Title}">${c8}</span>
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('content');

  chrome.storage.local.get(['hourDataObj', 'hourDataHtml', 'hourData'], (result) => {
    if (result.hourDataObj) {
      container.innerHTML = renderFromObj(result.hourDataObj);
    } else if (result.hourDataHtml) {
      // Fallback: HTML only (older storage)
      container.innerHTML = result.hourDataHtml
        .replace('class="kw-card"', '')
        .replace('<div class="kw-body">', '')
        .replace('</div>', '');
    } else if (result.hourData) {
      // Legacy plain text
      container.innerHTML = `<pre class="popup-pre">${result.hourData}</pre>`;
    } else {
      container.innerHTML = `<p class="popup-muted">No data available. Please open the Keka Attendance page.</p>`;
    }
  });
});
