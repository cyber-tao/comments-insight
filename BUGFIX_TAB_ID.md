# Bug Fix: No Tab ID Available Error

## Problem Description

When clicking "Start Extraction" button in the extension popup on a YouTube video page, the following error occurred:

```
[MessageRouter] Extraction task failed: Error: No tab ID available
[TaskManager] Task failed: task_xxx No tab ID available
[TaskManager] Failed to start task task_xxx: Error: Task task_xxx is not in pending state
```

## Root Cause

When a message is sent from the popup (not from a content script), the `sender.tab` property is `undefined` because:
- Popup is not a tab context
- `sender.tab?.id` returns `undefined`
- The extraction task requires a valid tab ID to send messages to the content script

## Solution

Modified `handleStartExtraction` method in `MessageRouter.ts` to:

1. **Check sender.tab.id first** - Use it if available (content script context)
2. **Query active tab** - If no tab ID, get the current active tab using `chrome.tabs.query`
3. **Error handling** - Add try-catch for tab query failures

### Code Changes

```typescript
// Get tab ID - either from sender or current active tab
let tabId = sender.tab?.id;

// If no tab ID (e.g., message from popup), get the active tab
if (!tabId) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = activeTab?.id;
  } catch (error) {
    console.error('[MessageRouter] Failed to get active tab:', error);
  }
}
```

## Testing

1. Open a YouTube video page
2. Click extension icon to open popup
3. Click "Start Extraction" button
4. ✅ Extraction should start successfully
5. ✅ No "No tab ID available" error

## Impact

- **Before**: Extraction failed when initiated from popup
- **After**: Extraction works from both popup and content script contexts

## Commit

```
fix: resolve 'No tab ID available' error when starting extraction from popup

- Get active tab ID when sender.tab is undefined (popup context)
- Use chrome.tabs.query to find current active tab
- Add error handling for tab query failures
- Fixes extraction task failure when initiated from extension popup
```

**Commit Hash**: 61d7af8
