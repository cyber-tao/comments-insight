# Scraper Configuration System

## 概述

将硬编码的网站爬取逻辑改为基于 JSON 配置文件的动态系统。

## 核心变更

### 1. 配置文件结构

```typescript
interface ScraperConfig {
  id: string;                    // 唯一标识符
  name: string;                  // 配置名称
  domains: string[];             // 适配的域名列表
  urlPatterns: string[];         // URL 匹配模式（正则）
  selectors: {
    commentContainer: string;    // 评论容器
    commentItem: string;         // 单个评论项
    username: string;            // 用户名
    content: string;             // 评论内容
    timestamp: string;           // 时间戳
    likes: string;               // 点赞数
    avatar?: string;             // 头像（可选）
    replyToggle?: string;        // 回复展开按钮（可选）
    replyContainer?: string;     // 回复容器（可选）
    replyItem?: string;          // 单个回复项（可选）
  };
  scrollConfig?: {
    enabled: boolean;
    maxScrolls: number;
    scrollDelay: number;
  };
  createdAt: number;
  updatedAt: number;
}
```

### 2. 移除硬编码

- 删除 `Platform` 类型枚举
- 移除 `PlatformDetector` 中的硬编码逻辑
- 移除 manifest.json 中的 `matches` 和 `host_permissions` 限制

### 3. 配置管理器

创建 `ScraperConfigManager` 类：
- 加载/保存配置
- 根据当前 URL 匹配配置
- CRUD 操作

### 4. Options 页面新增 Tab

在 Options 页面添加 "Scraper Configs" 标签页：
- 配置列表展示
- 可视化编辑器
- 添加/删除配置
- 导入/导出配置
- 测试配置

### 5. Popup 智能检测

- 检测当前页面是否有匹配的配置
- 如果没有配置，显示 "AI 分析爬取器" 按钮
- AI 分析完成后自动保存配置
- 启用 "提取评论" 按钮

### 6. AI 配置生成

创建新的 AI prompt 用于分析页面并生成配置：
- 传递完整的简化 DOM 结构
- AI 返回 selector 配置
- 根据模型的 maxTokens 限制 DOM 大小

## 实施步骤

1. 更新类型定义
2. 创建 ScraperConfigManager
3. 更新 manifest.json
4. 创建配置编辑器 UI
5. 更新 Popup 逻辑
6. 创建 AI 配置生成功能
7. 更新 CommentExtractor 使用配置
8. 测试和调试

## 文件变更清单

### 新增文件
- `src/types/scraper.ts` - 爬取器配置类型
- `src/utils/ScraperConfigManager.ts` - 配置管理器
- `src/components/ScraperConfigEditor.tsx` - 配置编辑器组件
- `src/utils/prompts-scraper.ts` - AI 配置生成 prompts

### 修改文件
- `src/types/index.ts` - 移除 Platform 枚举
- `src/manifest.json` - 移除域名限制
- `src/options/Options.tsx` - 添加新 tab
- `src/popup/Popup.tsx` - 添加 AI 分析按钮
- `src/content/PlatformDetector.ts` - 改为配置检测器
- `src/content/CommentExtractor.ts` - 使用配置而非硬编码
- `src/background/StorageManager.ts` - 添加配置存储
- `src/locales/*.json` - 添加新的翻译

### 删除文件
- 无（保留向后兼容）
