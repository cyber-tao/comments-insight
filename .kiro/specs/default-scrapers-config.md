# 默认爬取器配置

## 概述

扩展现在包含两个预配置的爬取器，在首次安装时自动加载。

## 配置文件位置

- **源文件**: `src/config/default-scrapers.json`
- **打包后**: `dist/src/config/default-scrapers.json`

## 默认支持的网站

### 1. YouTube

**配置 ID**: `youtube_default`

**适用域名**:
- youtube.com
- www.youtube.com

**URL 模式**: `/watch\?v=` (视频页面)

**选择器配置**:
```json
{
  "commentContainer": "#contents.ytd-item-section-renderer",
  "commentItem": "ytd-comment-thread-renderer",
  "username": "#author-text span",
  "content": "yt-attributed-string#content-text span",
  "timestamp": "#published-time-text a",
  "likes": "#vote-count-middle",
  "avatar": "#author-thumbnail img",
  "replyToggle": "ytd-button-renderer#more-replies button",
  "replyContainer": "#expander-contents #contents",
  "replyItem": "ytd-comment-view-model[is-reply]"
}
```

**滚动配置**:
- 启用自动滚动
- 最大滚动次数: 20
- 滚动延迟: 1500ms

### 2. Bilibili

**配置 ID**: `bilibili_default`

**适用域名**:
- bilibili.com
- www.bilibili.com

**URL 模式**: `/video/` (视频页面)

**选择器配置**:
```json
{
  "commentContainer": ".reply-list, .comment-list",
  "commentItem": ".reply-item, .list-item",
  "username": ".user-name, .root-reply-container .user-name",
  "content": ".reply-content, .root-reply-container .reply-content",
  "timestamp": ".reply-time, .sub-reply-time",
  "likes": ".reply-btn span, .like-text",
  "avatar": ".user-face img, .root-reply-avatar img",
  "replyToggle": ".view-more-btn, .btn-more",
  "replyContainer": ".sub-reply-list, .reply-box",
  "replyItem": ".sub-reply-item, .reply-box-item"
}
```

**滚动配置**:
- 启用自动滚动
- 最大滚动次数: 15
- 滚动延迟: 1200ms

## 实现细节

### 自动初始化

`ScraperConfigManager` 在首次访问时会自动加载默认配置：

1. 检查 `scraperConfigsInitialized` 标志
2. 如果未初始化，从 `default-scrapers.json` 加载配置
3. 保存到 Chrome Storage
4. 设置初始化标志

### 代码位置

**配置管理器**: `src/utils/ScraperConfigManager.ts`
- `initializeDefaults()` - 初始化默认配置
- `loadDefaultConfigs()` - 从文件加载配置

**Manifest 配置**: `src/manifest.json`
- `web_accessible_resources` - 允许访问配置文件

## 用户体验

### 首次安装

1. 用户安装扩展
2. 访问 YouTube 或 Bilibili 视频页面
3. 点击扩展图标
4. 直接显示"提取评论"按钮（无需 AI 生成配置）
5. 可以立即开始提取评论

### 配置管理

用户可以在 Options 页面的 "Scraper Configurations" 标签中：
- 查看默认配置
- 编辑默认配置
- 删除默认配置
- 添加新配置

## 更新配置

如果需要更新默认配置：

1. 编辑 `src/config/default-scrapers.json`
2. 运行 `npm run build`
3. 配置会被打包到 `dist` 目录

**注意**: 已安装扩展的用户不会自动更新配置。如需强制更新，需要：
- 清除 Chrome Storage 中的 `scraperConfigsInitialized` 标志
- 或者在代码中增加版本检查逻辑

## 选择器说明

### YouTube 选择器特点

- 使用 Web Components (ytd-* 标签)
- 评论和回复使用相同的组件 `ytd-comment-view-model`
- 通过 `[is-reply]` 属性区分回复
- 点赞数在 `#vote-count-middle` 中

### Bilibili 选择器特点

- 使用传统的 class 选择器
- 评论和回复使用不同的 class
- 支持多种可能的 class 名称（用逗号分隔）
- 点赞数在按钮的 span 中

## 测试建议

1. **YouTube 测试**:
   - 访问任意 YouTube 视频
   - 测试顶级评论提取
   - 测试回复展开和提取
   - 测试滚动加载

2. **Bilibili 测试**:
   - 访问任意 Bilibili 视频
   - 测试评论提取
   - 测试回复提取
   - 测试滚动加载

## 故障排除

如果默认配置不工作：

1. 检查网站是否更新了 HTML 结构
2. 在浏览器开发者工具中验证选择器
3. 更新 `default-scrapers.json` 中的选择器
4. 重新构建扩展

## 未来改进

- [ ] 添加更多默认支持的网站
- [ ] 实现配置版本管理和自动更新
- [ ] 添加配置测试工具
- [ ] 支持配置的在线更新
