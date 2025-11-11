# 设计文档

## 概述

Comments Insight（评论洞察）是一款基于Manifest V3的Chrome浏览器扩展，采用AI驱动的方式从多个社交媒体平台提取和分析评论数据。该扩展使用现代化的架构设计，包括Service Worker后台处理、Content Scripts页面交互、以及React/Vue构建的用户界面。

### 核心设计理念

1. **AI驱动的通用性**: 使用AI模型识别和提取评论，而非为每个平台编写特定代码
2. **分层架构**: 清晰分离UI层、业务逻辑层和数据层
3. **异步处理**: 所有耗时操作在后台执行，不阻塞用户界面
4. **可扩展性**: 易于添加新平台支持和新功能
5. **数据持久化**: 使用chrome.storage API保存设置和历史记录

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                              │
├─────────────────────────────────────────────────────────────┤
│  Popup UI    │  Options Page  │  History Page  │  Task Panel │
│  (React/Vue) │  (React/Vue)   │  (React/Vue)   │  (React/Vue)│
└──────┬───────┴────────┬────────┴────────┬───────┴──────┬─────┘
       │                │                 │              │
       └────────────────┴─────────────────┴──────────────┘
                              │
                    chrome.runtime.sendMessage
                              │
┌─────────────────────────────▼─────────────────────────────────┐
│                    Service Worker (后台)                       │
├─────────────────────────────────────────────────────────────┤
│  • Task Manager (任务管理)                                     │
│  • AI Service (AI服务调用)                                     │
│  • Storage Manager (数据存储)                                 │
│  • Message Router (消息路由)                                   │
└──────┬──────────────────────────────────────────────┬────────┘
       │                                               │
       │ chrome.scripting.executeScript                │ chrome.storage
       │ chrome.tabs.sendMessage                       │
       │                                               │
┌──────▼──────────────────────────────┐      ┌────────▼────────┐
│     Content Scripts (页面注入)       │      │  Chrome Storage │
├──────────────────────────────────────┤      │  • local        │
│  • DOM Analyzer (DOM分析)            │      │  • sync         │
│  • Comment Extractor (评论提取)      │      └─────────────────┘
│  • Page Controller (页面控制)        │
│  • Platform Detector (平台检测)      │
└──────┬──────────────────────────────┘
       │
       │ DOM API / Page Interaction
       │
┌──────▼──────────────────────────────┐
│         目标网页                     │
│  (YouTube, Bilibili, Twitter, etc.) │
└─────────────────────────────────────┘
```

### 技术栈选择

- **UI框架**: React (推荐) 或 Vue 3
- **构建工具**: Vite + CRXJS (Chrome Extension Tools)
- **状态管理**: Zustand (React) 或 Pinia (Vue)
- **样式方案**: Tailwind CSS + shadcn/ui
- **Markdown渲染**: react-markdown 或 marked.js
- **国际化**: i18next
- **类型检查**: TypeScript
- **测试框架**: Vitest + Testing Library

## 组件和接口设计

### 1. Service Worker (background.js)

Service Worker是扩展的核心，负责协调所有后台任务和消息传递。

#### 1.1 Task Manager (任务管理器)

```typescript
interface Task {
  id: string;
  type: 'extract' | 'analyze';
  status: 'pending' | 'running' | 'completed' | 'failed';
  url: string;
  platform: Platform;
  progress: number;
  startTime: number;
  endTime?: number;
  tokensUsed: number;
  error?: string;
}

class TaskManager {
  private tasks: Map<string, Task>;
  private queue: string[];
  
  createTask(type: Task['type'], url: string): string;
  startTask(taskId: string): Promise<void>;
  updateTaskProgress(taskId: string, progress: number): void;
  completeTask(taskId: string, result: any): void;
  failTask(taskId: string, error: string): void;
  getTask(taskId: string): Task | undefined;
  getAllTasks(): Task[];
  cancelTask(taskId: string): void;
}
```

#### 1.2 AI Service (AI服务)

```typescript
interface AIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
}

interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  config: AIConfig;
}

interface AIResponse {
  content: string;
  tokensUsed: number;
  finishReason: string;
}

class AIService {
  async callAI(request: AIRequest): Promise<AIResponse>;
  async getAvailableModels(apiUrl: string, apiKey: string): Promise<string[]>;
  async extractComments(domContent: string, config: AIConfig): Promise<Comment[]>;
  async analyzeComments(comments: Comment[], config: AIConfig): Promise<AnalysisResult>;
  private splitCommentsForAnalysis(comments: Comment[], maxTokens: number): Comment[][];
  private mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult;
}
```

#### 1.3 Storage Manager (存储管理器)

```typescript
interface Settings {
  maxComments: number;
  extractorModel: AIConfig;
  analyzerModel: AIConfig;
  analyzerPromptTemplate: string;
  language: 'zh-CN' | 'en-US';
}

interface HistoryItem {
  id: string;
  url: string;
  title: string;
  platform: Platform;
  timestamp: number;
  commentsCount: number;
  comments: Comment[];
  analysis: AnalysisResult;
}

class StorageManager {
  async getSettings(): Promise<Settings>;
  async saveSettings(settings: Partial<Settings>): Promise<void>;
  async exportSettings(): Promise<string>;
  async importSettings(data: string): Promise<void>;
  
  async saveHistory(item: HistoryItem): Promise<void>;
  async getHistory(): Promise<HistoryItem[]>;
  async getHistoryItem(id: string): Promise<HistoryItem | undefined>;
  async deleteHistoryItem(id: string): Promise<void>;
  async searchHistory(query: string): Promise<HistoryItem[]>;
}
```

#### 1.4 Message Router (消息路由)

```typescript
type MessageType = 
  | 'START_EXTRACTION'
  | 'START_ANALYSIS'
  | 'GET_TASK_STATUS'
  | 'CANCEL_TASK'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'GET_HISTORY'
  | 'EXPORT_DATA';

interface Message {
  type: MessageType;
  payload: any;
}

class MessageRouter {
  constructor(
    private taskManager: TaskManager,
    private aiService: AIService,
    private storageManager: StorageManager
  );
  
  handleMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<any>;
}
```

### 2. Content Scripts

Content Scripts注入到目标网页中，负责DOM分析和评论提取。

#### 2.1 Platform Detector (平台检测器)

```typescript
type Platform = 'youtube' | 'bilibili' | 'weibo' | 'douyin' | 'twitter' | 'tiktok' | 'reddit' | 'unknown';

class PlatformDetector {
  static detect(): Platform;
  static getPostInfo(): { url: string; title: string };
}
```

#### 2.2 DOM Analyzer (DOM分析器)

```typescript
interface DOMNode {
  tag: string;
  classes: string[];
  id?: string;
  text?: string;
  children?: DOMNode[];
  attributes?: Record<string, string>;
}

class DOMAnalyzer {
  // 分层分析DOM结构
  async analyzeLayerByLayer(maxDepth: number): Promise<DOMNode>;
  
  // 获取指定选择器的内容
  getContentBySelector(selector: string): string;
  
  // 将DOM节点序列化为AI可理解的格式
  serializeForAI(node: DOMNode, depth: number): string;
}
```

#### 2.3 Page Controller (页面控制器)

```typescript
class PageController {
  // 滚动页面以加载更多评论
  async scrollToLoadMore(maxScrolls: number): Promise<void>;
  
  // 展开折叠的回复
  async expandReplies(selector: string): Promise<void>;
  
  // 点击"加载更多"按钮
  async clickLoadMore(selector: string): Promise<void>;
  
  // 等待元素出现
  async waitForElement(selector: string, timeout: number): Promise<Element>;
}
```

#### 2.4 Comment Extractor (评论提取器)

```typescript
interface Comment {
  id: string;
  username: string;
  timestamp: string;
  likes: number;
  content: string;
  replies: Comment[];
}

class CommentExtractor {
  constructor(
    private domAnalyzer: DOMAnalyzer,
    private pageController: PageController,
    private aiService: AIService
  );
  
  async extract(maxComments: number): Promise<Comment[]>;
  
  private async identifyCommentStructure(): Promise<string>;
  private async extractByStructure(structure: string): Promise<Comment[]>;
}
```

### 3. UI Components

#### 3.1 Popup UI (弹出窗口)

```typescript
// 主要功能：快速启动提取和分析
interface PopupProps {}

const Popup: React.FC<PopupProps> = () => {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>();
  const [isExtracting, setIsExtracting] = useState(false);
  
  const handleStartExtraction = async () => {
    // 发送消息到Service Worker启动提取任务
  };
  
  return (
    <div className="w-80 p-4">
      <h1>Comments Insight</h1>
      <PlatformInfo platform={currentPlatform} />
      <Button onClick={handleStartExtraction}>开始提取评论</Button>
      <TaskList />
    </div>
  );
};
```

#### 3.2 Options Page (设置页面)

```typescript
interface OptionsPageProps {}

const OptionsPage: React.FC<OptionsPageProps> = () => {
  const [settings, setSettings] = useState<Settings>();
  
  return (
    <div className="container mx-auto p-8">
      <Tabs>
        <TabPanel label="基本设置">
          <MaxCommentsInput />
          <LanguageSelector />
        </TabPanel>
        
        <TabPanel label="AI模型配置">
          <AIModelConfig type="extractor" />
          <AIModelConfig type="analyzer" />
          <PromptTemplateEditor />
        </TabPanel>
        
        <TabPanel label="导入/导出">
          <ExportButton />
          <ImportButton />
        </TabPanel>
      </Tabs>
    </div>
  );
};
```

#### 3.3 History Page (历史记录页面)

```typescript
interface HistoryPageProps {}

const HistoryPage: React.FC<HistoryPageProps> = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem>();
  
  return (
    <div className="flex h-screen">
      <HistoryList 
        items={history}
        onSelect={setSelectedItem}
      />
      <HistoryDetail item={selectedItem} />
    </div>
  );
};
```

#### 3.4 Comments View (评论查看组件)

```typescript
interface CommentsViewProps {
  comments: Comment[];
  sortBy: 'time' | 'likes' | 'replies';
}

const CommentsView: React.FC<CommentsViewProps> = ({ comments, sortBy }) => {
  const sortedComments = useMemo(() => {
    return sortComments(comments, sortBy);
  }, [comments, sortBy]);
  
  return (
    <div>
      <SortSelector value={sortBy} onChange={setSortBy} />
      <CommentTree comments={sortedComments} />
    </div>
  );
};

// 递归渲染评论树
const CommentTree: React.FC<{ comments: Comment[] }> = ({ comments }) => {
  return (
    <div className="space-y-2">
      {comments.map(comment => (
        <CommentNode key={comment.id} comment={comment} />
      ))}
    </div>
  );
};

const CommentNode: React.FC<{ comment: Comment }> = ({ comment }) => {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <div className="border-l-2 pl-4">
      <div className="flex items-start gap-2">
        <Avatar username={comment.username} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold">{comment.username}</span>
            <span className="text-sm text-gray-500">{comment.timestamp}</span>
            <span className="text-sm">👍 {comment.likes}</span>
          </div>
          <p>{comment.content}</p>
          {comment.replies.length > 0 && (
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? '折叠' : '展开'} {comment.replies.length} 条回复
            </button>
          )}
        </div>
      </div>
      {expanded && comment.replies.length > 0 && (
        <div className="mt-2">
          <CommentTree comments={comment.replies} />
        </div>
      )}
    </div>
  );
};
```

#### 3.5 Analysis View (分析结果查看组件)

```typescript
interface AnalysisViewProps {
  analysis: AnalysisResult;
}

const AnalysisView: React.FC<AnalysisViewProps> = ({ analysis }) => {
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  
  return (
    <div>
      <ViewModeToggle value={viewMode} onChange={setViewMode} />
      {viewMode === 'rendered' ? (
        <MarkdownRenderer content={analysis.markdown} />
      ) : (
        <CodeBlock language="markdown" code={analysis.markdown} />
      )}
    </div>
  );
};
```

## 数据模型

### Comment (评论数据模型)

```typescript
interface Comment {
  id: string;                    // 唯一标识符
  username: string;              // 用户名
  userId?: string;               // 用户ID（如果可用）
  avatar?: string;               // 头像URL
  timestamp: string;             // 发布时间
  likes: number;                 // 点赞数
  content: string;               // 评论内容
  replies: Comment[];            // 回复列表（递归结构）
  isHot?: boolean;               // 是否为热点评论
  platform: Platform;            // 所属平台
}
```

### AnalysisResult (分析结果模型)

```typescript
interface AnalysisResult {
  markdown: string;              // Markdown格式的分析报告
  summary: {
    totalComments: number;       // 总评论数
    sentimentDistribution: {     // 情感分布
      positive: number;
      negative: number;
      neutral: number;
    };
    hotComments: Comment[];      // 热点评论列表
    keyInsights: string[];       // 关键洞察
  };
  tokensUsed: number;            // 消耗的token数
  generatedAt: number;           // 生成时间戳
}
```

### ExtractionResult (提取结果模型)

```typescript
interface ExtractionResult {
  comments: Comment[];
  metadata: {
    url: string;
    title: string;
    platform: Platform;
    extractedAt: number;
    totalCount: number;
  };
}
```

## 错误处理

### 错误类型定义

```typescript
enum ErrorCode {
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  
  // AI相关错误
  AI_TIMEOUT = 'AI_TIMEOUT',
  AI_RATE_LIMIT = 'AI_RATE_LIMIT',
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  
  // 提取错误
  PLATFORM_NOT_SUPPORTED = 'PLATFORM_NOT_SUPPORTED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  NO_COMMENTS_FOUND = 'NO_COMMENTS_FOUND',
  
  // 存储错误
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  
  // 配置错误
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_API_KEY = 'MISSING_API_KEY',
}

class ExtensionError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}
```

### 错误处理策略

1. **重试机制**: 对于网络错误和临时性AI错误，实施指数退避重试
2. **降级处理**: 当AI服务不可用时，提供基本的评论提取功能
3. **用户友好提示**: 将技术错误转换为用户可理解的提示信息
4. **错误日志**: 在开发模式下记录详细错误信息

```typescript
class ErrorHandler {
  static async handleError(error: Error, context: string): Promise<void> {
    if (error instanceof ExtensionError) {
      // 记录错误
      Logger.error(`[${context}] ${error.code}: ${error.message}`, error.details);
      
      // 显示用户友好的错误提示
      await this.showUserNotification(error);
      
      // 根据错误类型决定是否重试
      if (this.isRetryable(error.code)) {
        return this.retry(context);
      }
    } else {
      // 未知错误
      Logger.error(`[${context}] Unknown error:`, error);
      await this.showGenericError();
    }
  }
  
  private static isRetryable(code: ErrorCode): boolean {
    return [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.AI_TIMEOUT,
    ].includes(code);
  }
}
```

## 测试策略

### 单元测试

- **Service Worker组件**: 测试TaskManager、AIService、StorageManager的核心逻辑
- **Content Scripts**: 测试DOMAnalyzer、CommentExtractor的数据提取逻辑
- **UI组件**: 测试React/Vue组件的渲染和交互

### 集成测试

- **消息传递**: 测试Service Worker与Content Scripts之间的通信
- **存储操作**: 测试chrome.storage API的读写操作
- **AI服务集成**: 使用mock数据测试AI服务调用

### E2E测试

- 使用Puppeteer或Playwright测试完整的用户流程
- 测试在实际网页上的评论提取功能

## AI提示词设计

### 评论提取提示词

```typescript
const EXTRACTION_PROMPT_TEMPLATE = `
You are a web scraping expert. Your task is to analyze the DOM structure and extract comment data.

## DOM Structure:
{dom_content}

## Task:
1. Identify the comment section in the DOM
2. Extract all comments with the following information:
   - username
   - timestamp
   - likes count
   - comment content
   - replies (nested structure)

## Output Format:
Return ONLY a valid JSON array with no additional text:
[
  {
    "id": "unique_id",
    "username": "user_name",
    "timestamp": "time_string",
    "likes": 0,
    "content": "comment_text",
    "replies": []
  }
]

## Important:
- Return ONLY valid JSON, no markdown code blocks
- If no comments found, return empty array []
- Preserve the nested structure for replies
`;
```

### 评论分析提示词

```typescript
const ANALYSIS_PROMPT_TEMPLATE = `
You are a professional social media analyst. Analyze the following comments and provide insights.

## Comments Data:
{comments_json}

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics

## Output Format:
Generate a comprehensive analysis report in Markdown format with the following sections:

# Comment Analysis Report

## Executive Summary
[Brief overview of the analysis]

## Sentiment Distribution
- Positive: X%
- Negative: Y%
- Neutral: Z%

## Hot Comments Analysis
### Comment 1
- Content: [quote]
- Engagement: [likes count]
- Why it's hot: [analysis]

## Key Insights
1. [Insight 1]
2. [Insight 2]
...

## Detailed Findings
[In-depth analysis]

## Recommendations
[Actionable suggestions based on the analysis]

---
*Analysis generated on {timestamp}*
`;
```

### 用户自定义提示词模板

用户可以在设置中自定义分析提示词模板，使用以下占位符：
- `{comments_json}`: 评论数据的JSON格式
- `{timestamp}`: 当前时间戳
- `{platform}`: 平台名称
- `{url}`: 帖子URL

## 性能优化

### 1. 评论提取优化

- **分层加载**: 先提取顶层评论，再按需加载回复
- **增量提取**: 支持暂停和继续提取
- **智能滚动**: 根据页面加载速度动态调整滚动间隔

### 2. AI调用优化

- **批处理**: 将多个小请求合并为一个大请求
- **缓存**: 缓存相同内容的AI响应
- **流式处理**: 对于大量评论，使用流式API逐步返回结果

### 3. 存储优化

- **数据压缩**: 使用LZ-string压缩存储的评论数据
- **分页加载**: 历史记录采用分页加载，避免一次性加载所有数据
- **定期清理**: 提供选项自动清理旧的历史记录

### 4. UI性能优化

- **虚拟滚动**: 对于大量评论，使用react-window实现虚拟滚动
- **懒加载**: 图片和头像使用懒加载
- **防抖节流**: 对搜索和筛选操作进行防抖处理

### 5. 文本显示和编码处理

- **Unicode支持**: 确保正确处理和显示所有Unicode字符（中文、日文、韩文、表情符号等）
- **HTML实体解码**: 对评论中的HTML实体编码进行解码（如 `&amp;`, `&lt;`, `&gt;`, `&quot;` 等）
- **格式保持**: 保持评论的原始格式，包括换行符（`\n`）和空格
- **URL链接化**: 自动检测评论中的URL并转换为可点击的链接
- **XSS防护**: 在处理用户内容时进行适当的sanitize，防止XSS攻击

### 6. 导出功能优化

- **视图特定导出**: 根据当前视图（评论/分析）显示对应的导出选项
- **评论视图**: 仅显示CSV导出按钮
- **分析视图**: 仅显示Markdown导出按钮
- **清晰标注**: 导出按钮应清晰标注格式和用途，使用tooltip提供额外说明

## 安全性考虑

### 1. API密钥保护

- API密钥存储在chrome.storage.local中，不会同步到云端
- 在UI中显示API密钥时进行脱敏处理（显示为 `sk-****...****`）

### 2. 内容安全策略 (CSP)

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### 3. 权限最小化

只请求必要的权限：
- `storage`: 存储设置和历史记录
- `activeTab`: 访问当前标签页
- `scripting`: 注入Content Scripts
- `notifications`: 显示任务完成通知

### 4. 数据验证

- 对AI返回的JSON数据进行严格验证
- 对用户输入进行sanitize处理，防止XSS攻击

## 国际化方案

### 语言文件结构

```
locales/
├── zh-CN/
│   ├── common.json
│   ├── popup.json
│   ├── options.json
│   └── history.json
└── en-US/
    ├── common.json
    ├── popup.json
    ├── options.json
    └── history.json
```

### i18next配置

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: require('./locales/zh-CN/common.json'),
        popup: require('./locales/zh-CN/popup.json'),
      },
      'en-US': {
        common: require('./locales/en-US/common.json'),
        popup: require('./locales/en-US/popup.json'),
      },
    },
    lng: 'zh-CN', // 默认语言
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false,
    },
  });
```

## 部署和发布

### 构建流程

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build

# 打包为.zip文件
npm run package
```

### GitHub Actions自动发布

```yaml
name: Release Extension

on:
  push:
    tags:
      - 'v*'

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build extension
        run: npm run build
      
      - name: Package extension
        run: npm run package
      
      - name: Upload to Chrome Web Store
        uses: mnao305/chrome-extension-upload@v4
        with:
          file-path: ./dist/extension.zip
          extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
          client-id: ${{ secrets.CHROME_CLIENT_ID }}
          client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
      
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: ./dist/extension.zip
```

### 版本管理

- 使用语义化版本号 (Semantic Versioning)
- 在manifest.json中自动更新版本号
- 维护CHANGELOG.md记录每个版本的变更

## 开发模式与日志

### 日志系统

```typescript
enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class Logger {
  private static isDevelopment = process.env.NODE_ENV === 'development';
  
  static debug(message: string, ...args: any[]): void {
    if (this.isDevelopment) {
      console.log(`[${LogLevel.DEBUG}] ${message}`, ...args);
    }
  }
  
  static info(message: string, ...args: any[]): void {
    if (this.isDevelopment) {
      console.log(`[${LogLevel.INFO}] ${message}`, ...args);
    }
  }
  
  static warn(message: string, ...args: any[]): void {
    console.warn(`[${LogLevel.WARN}] ${message}`, ...args);
  }
  
  static error(message: string, ...args: any[]): void {
    console.error(`[${LogLevel.ERROR}] ${message}`, ...args);
  }
}
```

### 开发工具

- Chrome DevTools集成
- Service Worker调试面板
- Content Script调试工具
- 性能分析工具

## 参考资料

- [Chrome Extensions官方文档](https://developer.chrome.com/docs/extensions/)
- [Chrome Extensions示例](https://github.com/GoogleChrome/chrome-extensions-samples)
- [Manifest V3迁移指南](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [CRXJS Vite Plugin](https://crxjs.dev/vite-plugin/)
