// Background service worker: owns the offscreen ML document and routes messages.
// Designed to be stateless across service-worker restarts.

const OFFSCREEN_PATH = 'offscreen.html';
const JOB_PREFIX = 'job:';
const NOTIF_PREFIX = 'notif:';
const SHOW_PREFIX = 'show:';

let creatingOffscreen = false;

async function hasDocument() {
  const matchedClients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  });
  return matchedClients.some(c => c.url.includes(OFFSCREEN_PATH));
}

async function setupOffscreenDocument() {
  if (creatingOffscreen) {
    while (creatingOffscreen) await new Promise(r => setTimeout(r, 100));
    return;
  }
  if (await hasDocument()) return;

  creatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_PATH),
      reasons: ['WORKERS'],
      justification: 'Run the local ML embedding + UMAP pipeline in a background context so the user can navigate away while processing.',
    });
  } catch (err) {
    console.error('Failed to create offscreen document', err);
  } finally {
    creatingOffscreen = false;
  }
}

async function storeJobMeta(id, meta) {
  await chrome.storage.session.set({ [`${JOB_PREFIX}${id}`]: meta });
}

async function getJobMeta(id) {
  const data = await chrome.storage.session.get(`${JOB_PREFIX}${id}`);
  return data?.[`${JOB_PREFIX}${id}`] || null;
}

async function removeJobMeta(id) {
  await chrome.storage.session.remove(`${JOB_PREFIX}${id}`);
}

async function storeResult(url, snapshot) {
  const key = `result:${url}`;
  await chrome.storage.local.set({ [key]: { ...snapshot, created_at: Date.now() } });
}

async function forwardToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Tab may have navigated or closed.
  }
}

function notifyBackground(url, title) {
  chrome.notifications.create(`ready-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Sentiment Latent Space',
    message: `3D analysis is ready: ${title || 'Reddit post'}`,
    priority: 1,
  }, (id) => {
    chrome.storage.session.set({ [`${NOTIF_PREFIX}${id}`]: url });
  });
}

async function handleResult(id, snapshot) {
  const meta = await getJobMeta(id);
  if (!meta) return;
  await removeJobMeta(id);
  await storeResult(meta.url, snapshot);

  if (meta.tabId) {
    try {
      const tab = await chrome.tabs.get(meta.tabId);
      const tabUrl = (tab?.url || '').split('?')[0].split('#')[0];
      if (tabUrl === meta.url) {
        await forwardToTab(meta.tabId, { type: 'analysis-complete', url: meta.url, snapshot });
        return;
      }
    } catch (err) {
      // Tab closed or unavailable.
    }
  }
  notifyBackground(meta.url, meta.title);
}

async function handleProgress(id, stage, current, total) {
  const meta = await getJobMeta(id);
  if (meta?.tabId) {
    await forwardToTab(meta.tabId, { type: 'progress', id, stage, current, total });
  }
}

async function handleError(id, message) {
  const meta = await getJobMeta(id);
  if (meta?.tabId) {
    await forwardToTab(meta.tabId, { type: 'analysis-error', id, message });
  }
  await removeJobMeta(id);
}

// Global message handler (stateless).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return false;

  // Start a new job.
  if (request.type === 'process') {
    (async () => {
      const tabId = sender?.tab?.id || null;
      await storeJobMeta(request.id, { tabId, url: request.url, title: request.title });
      await setupOffscreenDocument();
      chrome.runtime.sendMessage({
        type: 'process',
        id: request.id,
        items: request.items,
        url: request.url,
        title: request.title,
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Offscreen progress.
  if (request.type === 'progress' && request.id) {
    handleProgress(request.id, request.stage, request.current, request.total);
    return false;
  }

  // Offscreen result.
  if (request.type === 'result' && request.id && request.snapshot) {
    handleResult(request.id, request.snapshot);
    return false;
  }

  // Offscreen error.
  if (request.type === 'error' && request.id) {
    handleError(request.id, request.message);
    return false;
  }

  // Offscreen keep-alive ping.
  if (request.type === 'offscreen-ping') {
    return false;
  }

  return false;
});

// Notification clicked: open the post and remember to auto-show the overlay.
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const data = await chrome.storage.session.get(`${NOTIF_PREFIX}${notificationId}`);
  const url = data?.[`${NOTIF_PREFIX}${notificationId}`];
  if (!url) return;

  chrome.tabs.create({ url }, (tab) => {
    if (tab?.id) {
      chrome.storage.session.set({ [`${SHOW_PREFIX}${tab.id}`]: url });
    }
  });
});

// Auto-show overlay when a tab navigates to a completed analysis URL.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url) return;
  const cleanUrl = tab.url.split('?')[0].split('#')[0];
  const data = await chrome.storage.session.get(`${SHOW_PREFIX}${tabId}`);
  const showUrl = data?.[`${SHOW_PREFIX}${tabId}`];
  if (showUrl && showUrl === cleanUrl) {
    await chrome.storage.session.remove(`${SHOW_PREFIX}${tabId}`);
    chrome.tabs.sendMessage(tabId, { type: 'auto-show', url: showUrl }).catch(() => {});
  }
});

// Clean up old results (7 days).
async function cleanupOldResults() {
  const all = await chrome.storage.local.get();
  const now = Date.now();
  const toRemove = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('result:') && value?.created_at && (now - value.created_at > 7 * 24 * 60 * 60 * 1000)) {
      toRemove.push(key);
    }
  }
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

chrome.runtime.onStartup.addListener(cleanupOldResults);
chrome.runtime.onInstalled.addListener(cleanupOldResults);
