// Listener for the extension icon click (note: will not fire if default_popup is set)
chrome.action.onClicked.addListener((tab) => {
  try {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (e) {
    // no-op
  }
});

// Store latest data sent from content script (HTML string for backward compatibility)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "keka-data") {
    chrome.storage.local.set({ hourDataHtml: message.data }, () => {
      sendResponse({ success: true });
    });
    return true; // indicate async response
  }
});
