# 需求文档

## 简介

Comments Insight（评论洞察）是一款智能Chrome浏览器扩展，旨在帮助用户从多个主流社交媒体平台（YouTube、Bilibili、微博、抖音、Twitter、TikTok、Reddit）提取和分析评论数据。该扩展利用AI技术自动识别和提取评论内容，并提供专业的情感分析和热点评论识别功能。

## 术语表

- **Extension**: Chrome浏览器扩展程序
- **Comment Extractor**: 负责从网页中提取评论数据的AI模块
- **Comment Analyzer**: 负责分析评论情感和热点的AI模块
- **Background Task Manager**: 后台任务管理系统
- **Settings Panel**: 用户配置界面
- **History Manager**: 历史记录管理系统
- **Export Module**: 数据导出功能模块
- **AI Provider**: 提供AI分析服务的API接口
- **Token**: AI模型处理的文本单位
- **Hot Comment**: 获得高互动度的热点评论

## 需求

### 需求 1: 评论数据提取

**用户故事:** 作为用户，我希望能够从支持的社交平台页面中提取所有评论数据，以便进行后续分析。

#### 验收标准

1. WHEN 用户在支持的平台页面上激活提取功能时，THE Extension SHALL 识别当前平台类型并启动相应的提取流程
2. THE Extension SHALL 提取每条评论的用户名、发布时间、点赞数和完整文本内容
3. THE Extension SHALL 提取每条评论的所有回复，包括回复的用户名、发布时间、点赞数和文本内容
4. WHILE 页面包含需要滚动加载的评论时，THE Comment Extractor SHALL 自动控制页面滚动以加载更多评论
5. WHEN 评论回复处于折叠状态时，THE Comment Extractor SHALL 自动触发展开操作以获取完整回复内容
6. THE Extension SHALL 支持从以下平台提取评论：YouTube、Bilibili、微博、抖音、Twitter、TikTok、Reddit

### 需求 2: AI驱动的智能提取

**用户故事:** 作为用户，我希望系统能够智能地识别不同平台的评论结构，而不需要为每个平台编写特定代码。

#### 验收标准

1. THE Comment Extractor SHALL 使用AI模型分析网页DOM结构以识别评论元素
2. THE Comment Extractor SHALL 采用分层分析策略，从外层结构逐步深入到内层元素
3. WHEN 向AI模型发送网页内容时，THE Extension SHALL 使用结构化提示词要求AI以JSON格式返回提取结果
4. THE Comment Extractor SHALL 根据AI的决策选择需要获取的网页内容结构，以优化提取效率
5. THE Extension SHALL 验证AI返回的JSON数据格式的完整性和正确性

### 需求 3: 评论分析功能

**用户故事:** 作为用户，我希望获得专业的评论分析报告，包括情感分析和热点评论识别，以便了解用户反馈趋势。

#### 验收标准

1. THE Comment Analyzer SHALL 分析所有提取评论的情感倾向（正面、负面、中性）
2. THE Comment Analyzer SHALL 识别热点评论并分析其成为热点的原因
3. THE Comment Analyzer SHALL 以Markdown格式生成整体评论趋势的专业分析报告
4. WHEN 评论数据量超过模型最大token限制时，THE Extension SHALL 将评论分批处理并合并分析结果
5. THE Comment Analyzer SHALL 在分析报告中包含统计数据、情感分布和关键洞察
6. THE Extension SHALL 在向AI发送分析请求时明确要求输出Markdown格式的结果

### 需求 4: 评论查看与展示

**用户故事:** 作为用户，我希望能够以树型结构查看所有评论和回复，并能按不同方式排序，以便更好地理解评论层次关系。

#### 验收标准

1. THE Extension SHALL 以树型结构展示评论和回复的层级关系
2. THE Extension SHALL 支持按时间、点赞数和回复数对评论进行排序
3. THE Extension SHALL 在树型视图中清晰显示每条评论的缩进层级
4. THE Extension SHALL 允许用户展开或折叠评论的回复分支
5. THE Extension SHALL 在评论列表中高亮显示热点评论

### 需求 5: 数据导出功能

**用户故事:** 作为用户，我希望能够导出评论数据和分析结果，以便在其他工具中使用或存档。

#### 验收标准

1. THE Export Module SHALL 支持将评论数据导出为CSV格式文件
2. THE Export Module SHALL 支持将分析结果导出为Markdown格式文件
3. THE Export Module SHALL 在CSV文件中包含所有评论字段（用户名、时间、点赞数、内容、回复）
4. THE Export Module SHALL 在Markdown文件中包含完整的分析报告和可视化数据
5. WHEN 用户触发导出操作时，THE Extension SHALL 在3秒内生成下载链接

### 需求 6: 分析结果展示

**用户故事:** 作为用户，我希望分析结果页面能够渲染Markdown格式的内容，以便获得更好的阅读体验。

#### 验收标准

1. THE Extension SHALL 在分析结果页面中渲染Markdown格式的内容
2. THE Extension SHALL 支持Markdown的标题、列表、表格、代码块等常用语法
3. THE Extension SHALL 在渲染Markdown时保持良好的样式和排版
4. THE Extension SHALL 支持在Markdown内容中显示图表和统计数据
5. THE Extension SHALL 允许用户在原始Markdown和渲染视图之间切换

### 需求 7: 设置管理

**用户故事:** 作为用户，我希望能够配置扩展的各项参数，包括AI模型设置、提取限制和分析提示词，以便根据需求定制功能。

#### 验收标准

1. THE Settings Panel SHALL 允许用户设置最大评论提取数量
2. THE Settings Panel SHALL 允许用户配置AI Provider的API URL和API Key
3. WHEN 用户输入有效的API凭证时，THE Extension SHALL 获取并显示可用的AI模型列表
4. THE Settings Panel SHALL 允许用户分别选择用于评论提取和评论分析的AI模型
5. THE Settings Panel SHALL 允许用户配置模型参数，包括最大token数、温度（temperature）和top_p值
6. THE Settings Panel SHALL 允许用户自定义分析评论时使用的提示词模板
7. THE Extension SHALL 支持导出当前设置为配置文件
8. THE Extension SHALL 支持从配置文件导入设置

### 需求 8: 后台任务管理

**用户故事:** 作为用户，我希望评论提取和分析任务能在后台运行，并能查看任务进度和状态，以便不影响我的其他浏览活动。

#### 验收标准

1. THE Background Task Manager SHALL 支持在后台执行评论提取和分析任务
2. THE Extension SHALL 提供任务列表界面显示所有正在进行和已完成的任务
3. THE Extension SHALL 实时显示每个任务的状态（进行中、已完成、失败）
4. THE Extension SHALL 显示每个任务的执行时间和消耗的token数量
5. WHEN 任务完成时，THE Extension SHALL 显示浏览器通知提醒用户
6. THE Extension SHALL 允许用户取消正在进行的任务

### 需求 9: 历史记录管理

**用户故事:** 作为用户，我希望能够查看之前分析过的帖子记录，以便回顾历史数据和分析结果。

#### 验收标准

1. THE History Manager SHALL 保存所有已完成分析的帖子记录
2. THE Extension SHALL 在历史记录中显示帖子标题、分析时间和平台信息
3. WHEN 用户点击历史记录项时，THE Extension SHALL 显示该帖子的完整评论数据和分析结果
4. THE History Manager SHALL 提供指向原始帖子的可点击链接
5. THE Extension SHALL 允许用户删除历史记录项
6. THE Extension SHALL 支持搜索和筛选历史记录

### 需求 10: 多语言支持

**用户故事:** 作为国际用户，我希望扩展界面能够显示我熟悉的语言，以便更好地使用功能。

#### 验收标准

1. THE Extension SHALL 支持中文和英文两种界面语言
2. WHEN 扩展首次启动时，THE Extension SHALL 根据浏览器语言自动选择界面语言
3. IF 浏览器语言不在支持列表中，THEN THE Extension SHALL 默认使用英文界面
4. THE Settings Panel SHALL 允许用户手动切换界面语言
5. THE Extension SHALL 在语言切换后立即更新所有界面文本

### 需求 11: 用户体验设计

**用户故事:** 作为用户，我希望扩展具有直观的界面和流畅的交互体验，以便轻松完成各项操作。

#### 验收标准

1. THE Extension SHALL 提供清晰的视觉层次和一致的设计风格
2. THE Extension SHALL 在所有操作中提供即时的视觉反馈
3. THE Extension SHALL 使用加载动画指示正在进行的操作
4. THE Extension SHALL 在错误发生时显示清晰的错误消息和建议操作
5. THE Extension SHALL 确保所有交互元素具有适当的大小和间距，便于点击操作

### 需求 12: 开发与部署

**用户故事:** 作为开发者，我希望项目具有清晰的开发模式和自动化部署流程，以便高效开发和发布。

#### 验收标准

1. THE Extension SHALL 支持开发模式和发布模式两种运行模式
2. WHILE 运行在开发模式时，THE Extension SHALL 输出详细的调试日志
3. WHILE 运行在发布模式时，THE Extension SHALL 仅输出关键错误日志
4. THE Extension SHALL 包含所有代码注释和日志输出均使用英文
5. WHEN 创建版本tag时，THE Extension SHALL 通过GitHub Actions自动构建并发布到Chrome Web Store
