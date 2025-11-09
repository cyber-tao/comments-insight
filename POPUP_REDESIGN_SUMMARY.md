# Popup Redesign and Feature Separation

## Overview
Complete redesign of the popup interface with separation of extraction and analysis operations.

## Key Changes

### 1. Separate Extraction and Analysis
**Before**: Extraction automatically triggered analysis
**After**: Two independent operations
- Extract Comments: Only extracts comments from the page
- Analyze Comments: Analyzes previously extracted comments

### 2. Redesigned Popup UI
**New Design Features**:
- Modern gradient design (blue-to-purple theme)
- Compact header with version display
- Settings moved to top-right icon button
- Three main action buttons with icons
- Page status section showing extraction/analysis state

### 3. Page Status Tracking
**Displays**:
- Platform detection (YouTube, Bilibili, etc.)
- Extraction status (Not Extracted / Extracted / Analyzed)
- Comment count
- Extraction timestamp (relative time)
- Analysis timestamp (if analyzed)

### 4. Smart Button States
- Extract Comments: Enabled only on valid pages
- Analyze Comments: Enabled only after extraction
- View History: Always enabled

### 5. Version Display
- Automatically reads version from manifest.json
- Displayed in popup header
- No hardcoded version numbers

## Type System Changes

### HistoryItem Interface
```typescript
interface HistoryItem {
  id: string;
  url: string;
  title: string;
  platform: Platform;
  extractedAt: number;        // Changed from 'timestamp'
  commentsCount: number;
  comments: Comment[];
  analysis?: AnalysisResult;  // Now optional
  analyzedAt?: number;        // New field
}
```

### New Message Type
- `GET_HISTORY_BY_URL`: Find history item by URL

## UI Components

### Popup Layout
```
┌─────────────────────────────────┐
│ Header (Gradient)               │
│ Title + Version    [⚙️ Settings]│
├─────────────────────────────────┤
│ Current Page Status             │
│ - Platform: YouTube             │
│ - Status: Extracted             │
│ - Comments: 150                 │
│ - Extracted: 5 min ago          │
├─────────────────────────────────┤
│ [📥 Extract Comments]           │
│ [📊 Analyze Comments]           │
│ [🕐 View History]               │
└─────────────────────────────────┘
```

### Status Badge Colors
- **Gray**: Not Extracted
- **Blue**: Extracted (not analyzed)
- **Green**: Analyzed

## Backend Changes

### MessageRouter
1. **handleGetHistoryByUrl**: New method to find history by URL
2. **handleStartExtraction**: No longer auto-starts analysis
3. **handleStartAnalysis**: Accepts historyId to update existing record
4. **startAnalysisTask**: Updates existing history item with analysis

### StorageManager
- Sort by `extractedAt` instead of `timestamp`

## Translations

### New Keys (zh-CN / en-US)
- `popup.version`: 版本 / Version
- `popup.extractComments`: 提取评论 / Extract Comments
- `popup.analyzeComments`: 分析评论 / Analyze Comments
- `popup.viewHistory`: 历史记录 / View History
- `popup.currentPage`: 当前页面 / Current Page
- `popup.platform`: 平台 / Platform
- `popup.status`: 状态 / Status
- `popup.notExtracted`: 未提取 / Not Extracted
- `popup.extracted`: 已提取 / Extracted
- `popup.analyzed`: 已分析 / Analyzed
- `popup.extractedAt`: 提取时间 / Extracted At
- `popup.analyzedAt`: 分析时间 / Analyzed At
- `popup.commentsCount`: 评论数 / Comments
- `popup.justNow`: 刚刚 / Just now
- `popup.minutesAgo`: 分钟前 / min ago
- `popup.hoursAgo`: 小时前 / hours ago
- `popup.daysAgo`: 天前 / days ago

## User Workflow

### Extraction Only
1. Open YouTube video
2. Click extension icon
3. Click "Extract Comments"
4. Comments saved to history (no analysis)

### Extraction + Analysis
1. Extract comments (as above)
2. Click extension icon again
3. Click "Analyze Comments"
4. Analysis added to existing history item

### View Previous Data
1. Click extension icon
2. See status: "Extracted 2 hours ago"
3. Can re-analyze or view history

## Benefits

1. **Flexibility**: Users can extract without analyzing
2. **Cost Control**: Analysis uses AI tokens - users decide when
3. **Better UX**: Clear status and action buttons
4. **Performance**: Faster extraction without forced analysis
5. **Data Management**: Separate timestamps for extraction and analysis

## Testing Checklist

- [ ] Extract comments on valid page
- [ ] Verify extraction status shows correctly
- [ ] Analyze extracted comments
- [ ] Verify analysis status updates
- [ ] Check timestamps display correctly
- [ ] Test on invalid page (buttons disabled)
- [ ] Verify version number displays
- [ ] Test settings icon opens options page
- [ ] Test history button opens history page
- [ ] Verify relative time formatting

## Commit
**Hash**: e92d0fb
**Type**: feat (new feature)
**Files Changed**: 11
**Lines**: +439 / -239
