// Content script: injected on Reddit post pages. Coordinates with background service worker.

const BTN_ID = 'sls-analyze-btn';
const VIEW_BTN_ID = 'sls-view-btn';
const PROGRESS_ID = 'sls-progress-pill';
const OVERLAY_ID = 'sls-overlay';

let currentJobId = 0;

// --- UI helpers ---

function removeElement(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function showProgressPill(text, progress = null) {
  removeElement(PROGRESS_ID);
  const pill = document.createElement('div');
  pill.id = PROGRESS_ID;
  pill.innerHTML = `
    <div class="sls-pill-spinner"></div>
    <div class="sls-pill-text">${text}</div>
    <div class="sls-pill-bar"><div class="sls-pill-fill" style="width:0%"></div></div>
  `;
  Object.assign(pill.style, {
    position: 'fixed',
    bottom: '22px',
    right: '22px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderRadius: '50px',
    background: 'rgba(10, 10, 14, 0.92)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 6px 22px rgba(0,0,0,0.35)',
    cursor: 'default',
    maxWidth: '320px',
  });

  // Add styles for inner elements if not already present
  if (!document.getElementById('sls-pill-styles')) {
    const style = document.createElement('style');
    style.id = 'sls-pill-styles';
    style.textContent = `
      .sls-pill-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.15); border-top-color: #3b82f6; border-radius: 50%; animation: sls-spin 0.8s linear infinite; flex-shrink: 0; }
      .sls-pill-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sls-pill-bar { position: absolute; bottom: 0; left: 10px; right: 10px; height: 2px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
      .sls-pill-fill { height: 100%; background: #3b82f6; transition: width 0.3s; }
      @keyframes sls-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(pill);
  if (progress !== null) updateProgressPill(text, progress);
  return pill;
}

function updateProgressPill(text, progress) {
  const pill = document.getElementById(PROGRESS_ID);
  if (!pill) return;
  pill.querySelector('.sls-pill-text').textContent = text;
  const fill = pill.querySelector('.sls-pill-fill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function hideProgressPill() {
  removeElement(PROGRESS_ID);
}

function showToast(message, type = 'info', duration = 4000) {
  const existing = document.querySelector('.sls-toast');
  if (existing) existing.remove();
  const bg = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
  const toast = document.createElement('div');
  toast.className = 'sls-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    padding: '12px 18px',
    borderRadius: '10px',
    background: bg,
    color: '#fff',
    fontWeight: '500',
    fontSize: '13px',
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    maxWidth: '360px',
    lineHeight: '1.4',
  });
  document.body.appendChild(toast);
  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  return toast;
}

function showError(message, retry) {
  hideProgressPill();
  const panel = document.createElement('div');
  panel.id = 'sls-error-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '22px',
    right: '22px',
    zIndex: '2147483647',
    padding: '14px 18px',
    borderRadius: '14px',
    background: 'rgba(30, 10, 10, 0.95)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#fff',
    fontSize: '13px',
    maxWidth: '320px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  });
  panel.innerHTML = `
    <div style="font-weight:600;color:#ef4444;margin-bottom:6px;">Analysis failed</div>
    <div style="color:#d4d4d8;margin-bottom:12px;line-height:1.5;">${message}</div>
    <button id="sls-retry-btn" style="padding:8px 14px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Try again</button>
  `;
  document.body.appendChild(panel);
  document.getElementById('sls-retry-btn').addEventListener('click', () => {
    panel.remove();
    if (retry) retry();
  });
}

function showOverlay(snapshot) {
  removeElement(OVERLAY_ID);
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    background: '#050505',
    border: 'none',
  });
  document.body.appendChild(overlay);

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('overlay.html');
  Object.assign(iframe.style, { width: '100%', height: '100%', border: 'none' });
  overlay.appendChild(iframe);

  const sendSnapshot = () => {
    iframe.contentWindow.postMessage({ type: 'snapshot', snapshot }, '*');
  };

  iframe.addEventListener('load', sendSnapshot);
  setTimeout(sendSnapshot, 500);
}

function removeOverlay() {
  removeElement(OVERLAY_ID);
  hideProgressPill();
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'close-overlay') {
    removeOverlay();
  }
});

// --- Reddit parsing ---

function flattenComments(children, postTitle, postPermalink) {
  const items = [];
  for (const child of children) {
    if (child.kind !== 't1') continue;
    const data = child.data || {};
    const body = data.body || '';
    if (!body || body === '[deleted]' || body === '[removed]') continue;
    items.push({
      text: body,
      title: postTitle,
      url: `https://www.reddit.com${data.permalink || postPermalink}`,
      author: String(data.author || 'unknown'),
      is_post: false,
      comment_score: data.score || 0,
      keyword: postTitle,
    });
    const replies = data.replies;
    if (replies && typeof replies === 'object') {
      const replyData = replies.data || {};
      items.push(...flattenComments(replyData.children || [], postTitle, postPermalink));
    }
  }
  return items;
}

function parseRedditPost(data, url, maxComments) {
  const postData = (data?.[0]?.data?.children?.[0]?.data) || {};
  const postTitle = postData.title || '';
  let postBody = postTitle;
  if (postData.selftext) postBody += '\n\n' + postData.selftext;

  const items = [{
    text: postBody,
    title: postTitle,
    url: postData.url || url,
    author: String(postData.author || 'unknown'),
    is_post: true,
    comment_score: 0,
    keyword: postTitle,
  }];

  const commentChildren = data?.[1]?.data?.children || [];
  let comments = flattenComments(commentChildren, postTitle, postData.permalink || '');
  comments.sort((a, b) => b.comment_score - a.comment_score);
  items.push(...comments.slice(0, maxComments));
  return items;
}

// --- Background communication ---

async function startAnalysis(url, title, items) {
  const id = ++currentJobId;
  showProgressPill('Starting analysis...', 0);

  try {
    await chrome.runtime.sendMessage({
      type: 'process',
      id,
      url,
      title,
      items,
    });
  } catch (err) {
    showError(err.message || 'Could not start analysis. Is the extension enabled?', () => {
      startAnalysis(url, title, items);
    });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === 'progress') {
    const { stage, current, total } = message;
    let text = 'Analyzing...';
    let pct = 0;
    if (stage === 'model') { text = 'Loading AI model...'; pct = 5; }
    else if (stage === 'embed') { text = `Embedding ${current}/${total} comments...`; pct = 5 + (current / total) * 70; }
    else if (stage === 'project') { text = 'Projecting into 3D...'; pct = 80; }
    else if (stage === 'cluster') { text = 'Clustering...'; pct = 95; }
    updateProgressPill(text, pct);
  }

  if (message.type === 'analysis-complete') {
    hideProgressPill();
    if (message.snapshot) {
      showOverlay(message.snapshot);
    } else {
      showToast('Analysis complete. Re-open the post to view.', 'success');
    }
  }

  if (message.type === 'analysis-error') {
    hideProgressPill();
    showError(message.message || 'Analysis failed.', () => {
      const btn = document.getElementById(BTN_ID);
      if (btn) btn.click();
    });
  }

  if (message.type === 'auto-show' && message.url) {
    const cleanUrl = window.location.href.split('?')[0].split('#')[0];
    if (cleanUrl === message.url) {
      loadCachedResult(message.url);
    }
  }
});

// --- Cached results ---

async function loadCachedResult(url) {
  const key = `result:${url}`;
  const data = await chrome.storage.local.get(key);
  const snapshot = data?.[key];
  if (snapshot) {
    showOverlay(snapshot);
  }
}

async function checkCachedResult(url) {
  const key = `result:${url}`;
  const data = await chrome.storage.local.get(key);
  return data?.[key] || null;
}

// --- Buttons ---

const buttonBaseStyle = {
  position: 'fixed',
  bottom: '22px',
  right: '22px',
  zIndex: '2147483640',
  padding: '12px 18px',
  borderRadius: '50px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 100%)',
  color: '#fff',
  fontWeight: '600',
  fontSize: '14px',
  cursor: 'pointer',
  boxShadow: '0 6px 22px rgba(59,130,246,0.45)',
  transition: 'transform 0.18s, box-shadow 0.18s, background 0.18s',
  display: 'flex',
  alignItems: 'center',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

function addHoverEffects(btn) {
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-2px) scale(1.02)';
    btn.style.boxShadow = '0 10px 28px rgba(59,130,246,0.55)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translateY(0) scale(1)';
    btn.style.boxShadow = '0 6px 22px rgba(59,130,246,0.45)';
  });
}

function injectAnalyzeButton() {
  if (document.getElementById(BTN_ID)) return;
  if (!window.location.pathname.includes('/comments/')) return;

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.innerHTML = `
    <span style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:8px;font-size:14px;">&#9670;</span>
    <span>Analyze in 3D</span>
  `;
  Object.assign(btn.style, buttonBaseStyle);
  addHoverEffects(btn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    const cleanUrl = window.location.href.split('?')[0].split('#')[0];
    const jsonUrl = cleanUrl.replace(/\/?$/, '') + '.json';

    showProgressPill('Fetching post...', 0);

    try {
      const redditRes = await fetch(jsonUrl);
      if (!redditRes.ok) {
        throw new Error(`Reddit returned ${redditRes.status}. Try refreshing the page.`);
      }
      const data = await redditRes.json();
      const items = parseRedditPost(data, cleanUrl, 100);
      if (items.length < 2) {
        throw new Error('No comments found on this post.');
      }
      btn.style.display = 'none';
      await startAnalysis(cleanUrl, items[0]?.title || 'Reddit post', items);
    } catch (err) {
      hideProgressPill();
      btn.disabled = false;
      btn.style.opacity = '1';
      showError(err.message, () => btn.click());
    }
  });

  document.body.appendChild(btn);
}

function injectViewButton(snapshot) {
  if (document.getElementById(VIEW_BTN_ID)) return;
  if (!window.location.pathname.includes('/comments/')) return;

  const btn = document.createElement('button');
  btn.id = VIEW_BTN_ID;
  btn.innerHTML = `
    <span style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:8px;font-size:14px;">&#9670;</span>
    <span>View 3D analysis</span>
  `;
  Object.assign(btn.style, {
    ...buttonBaseStyle,
    background: 'linear-gradient(135deg, #14532d 0%, #10b981 100%)',
    boxShadow: '0 6px 22px rgba(16, 185, 129, 0.45)',
  });
  addHoverEffects(btn);
  btn.addEventListener('click', () => showOverlay(snapshot));
  document.body.appendChild(btn);
}

function postDeletedOnPage() {
  const text = document.body?.textContent || '';
  return /this post was deleted/i.test(text) ||
         /this post has been removed/i.test(text) ||
         /sorry, this post has been removed by the moderators/i.test(text);
}

async function clearCachedResult(url) {
  const key = `result:${url}`;
  await chrome.storage.local.remove(key);
}

async function injectButtonForCurrentPage() {
  const cleanUrl = window.location.href.split('?')[0].split('#')[0];
  if (!window.location.pathname.includes('/comments/')) return;

  if (postDeletedOnPage()) {
    await clearCachedResult(cleanUrl);
    return;
  }

  const snapshot = await checkCachedResult(cleanUrl);
  if (snapshot) {
    injectViewButton(snapshot);
  } else {
    injectAnalyzeButton();
  }
}

// --- SPA navigation handling ---

let lastUrl = location.href;

function onNavigation() {
  const currentUrl = location.href;
  if (currentUrl === lastUrl) return;
  lastUrl = currentUrl;
  removeOverlay();
  removeElement(BTN_ID);
  removeElement(VIEW_BTN_ID);
  removeElement('sls-error-panel');
  injectButtonForCurrentPage();
}

const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;
history.pushState = function (...args) {
  originalPushState.apply(this, args);
  onNavigation();
};
history.replaceState = function (...args) {
  originalReplaceState.apply(this, args);
  onNavigation();
};
window.addEventListener('popstate', onNavigation);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectButtonForCurrentPage);
} else {
  injectButtonForCurrentPage();
}

// Debounced observer: watches the full document for DOM changes
// and re-injects if the button was wiped out by Reddit's SPA.
let injectTimer = null;
const observer = new MutationObserver(() => {
  if (!window.location.pathname.includes('/comments/')) return;
  if (document.getElementById(BTN_ID) || document.getElementById(VIEW_BTN_ID)) return;
  clearTimeout(injectTimer);
  injectTimer = setTimeout(injectButtonForCurrentPage, 300);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
