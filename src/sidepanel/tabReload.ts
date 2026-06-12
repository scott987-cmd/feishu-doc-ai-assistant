/**
 * Reload the active tab (the Feishu page). API deletes/restores don't show in Feishu's cached
 * frontend until the page reloads — so after a destructive op we refresh it for the user instead
 * of making them do it manually. Side-panel only (uses chrome.tabs); no-ops elsewhere.
 */
export function reloadActiveTab(): void {
  try {
    chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs?.[0]?.id
      if (id != null) chrome.tabs.reload(id)
    })
  } catch { /* ignore */ }
}
