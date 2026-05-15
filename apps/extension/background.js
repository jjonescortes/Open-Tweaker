// background.js — service worker
// Opens the side panel on toolbar click and bridges
// messages between the panel and the active tab's content script.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// When the panel sends a message to the content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages FROM the panel (no sender.tab) → forward to active tab
  if (!sender.tab) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, msg, (resp) => {
        if (chrome.runtime.lastError) return; // tab not ready yet
        sendResponse(resp);
      });
    });
    return true; // keep channel open for async response
  }

  // Messages FROM the content script → forward to the panel
  chrome.runtime.sendMessage(msg).catch(() => {});
});

// Re-inject content script into existing tabs when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.url?.startsWith('chrome://')) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-script.js'],
        }).catch(() => {});
      }
    }
  });
});
