# 导入冲突解决功能

## 概述

在导入爬取器配置时，系统会自动检测冲突并提供用户友好的解决方案。

## 冲突类型

### 1. ID 冲突 (duplicate_id)
- 导入的配置与现有配置具有相同的 ID
- 显示为"重复的配置 ID"

### 2. 域名冲突 (duplicate_domain)
- 导入的配置与现有配置具有相同的域名
- 显示为"重复的域名"

## 用户流程

### 1. 导入配置
用户点击"导入"按钮并选择 JSON 文件

### 2. 冲突检测
系统自动检测：
- ID 是否重复
- 域名是否重复

### 3. 冲突对话框
如果发现冲突，显示对话框：
- 左侧：导入的配置（蓝色背景）
- 右侧：现有配置（黄色背景）
- 显示配置名称、域名、ID

### 4. 用户选择
对每个冲突，用户可以选择：
- **跳过此项** - 保留现有配置，不导入
- **覆盖现有** - 删除现有配置，导入新配置

### 5. 应用决定
用户点击"应用决定"按钮，系统执行操作

### 6. 结果反馈
显示导入结果：
- 成功导入 X 个
- 跳过 X 个
- 覆盖 X 个


## 技术实现

### ScraperConfigManager 新增方法

#### checkImportConflicts()
```typescript
static async checkImportConflicts(importedConfigs: ScraperConfig[]): Promise<{
  conflicts: Array<{
    imported: ScraperConfig;
    existing: ScraperConfig;
    reason: string;
  }>;
  newConfigs: ScraperConfig[];
}>
```
检测导入配置与现有配置的冲突

#### importConfigs() - 更新
```typescript
static async importConfigs(
  jsonString: string,
  conflictResolution: 'skip' | 'overwrite' | 'ask' = 'ask'
): Promise<{
  imported: number;
  skipped: number;
  overwritten: number;
  conflicts?: Array<...>;
}>
```
支持三种冲突解决策略：
- `ask` - 询问用户（默认）
- `skip` - 自动跳过冲突
- `overwrite` - 自动覆盖

#### resolveImportConflicts()
```typescript
static async resolveImportConflicts(
  conflicts: Array<...>,
  decisions: Array<'skip' | 'overwrite'>
): Promise<number>
```
根据用户决定解决冲突

### UI 组件更新

#### ScraperConfigList 新增状态
- `importConflicts` - 冲突列表
- `showConflictDialog` - 显示冲突对话框
- `conflictDecisions` - 用户决定数组

#### 冲突对话框 UI
- 网格布局显示冲突
- 蓝色背景：导入的配置
- 黄色背景：现有配置
- 按钮切换选择状态
- 批量应用决定

## 翻译键

### 中文 (zh-CN)
- `scraper.importConflicts` - "导入冲突"
- `scraper.importConflictsHint` - 提示文本
- `scraper.duplicateId` - "重复的配置 ID"
- `scraper.duplicateDomain` - "重复的域名"
- `scraper.importedConfig` - "导入的配置"
- `scraper.existingConfig` - "现有配置"
- `scraper.skipThis` - "跳过此项"
- `scraper.overwriteThis` - "覆盖现有"
- `scraper.applyDecisions` - "应用决定"
- `scraper.skippedCount` - "跳过 {count} 个"
- `scraper.overwrittenCount` - "覆盖 {count} 个"
- `scraper.noChanges` - "未进行任何更改"

### 英文 (en-US)
对应的英文翻译

## 使用示例

### 场景 1: 无冲突导入
1. 用户导入配置文件
2. 系统检测无冲突
3. 直接导入成功
4. 显示"成功导入 X 个配置"

### 场景 2: 有冲突导入
1. 用户导入配置文件
2. 系统检测到 2 个冲突
3. 显示冲突对话框
4. 用户选择：
   - 第 1 个：跳过
   - 第 2 个：覆盖
5. 点击"应用决定"
6. 显示结果：
   - "成功导入 3 个配置"
   - "跳过 1 个"
   - "覆盖 1 个"

## 优势

1. **用户控制** - 用户完全控制如何处理冲突
2. **清晰对比** - 并排显示冲突配置
3. **批量处理** - 一次性处理所有冲突
4. **安全性** - 默认跳过，避免意外覆盖
5. **反馈明确** - 清楚显示操作结果

## 测试建议

### 测试 1: ID 冲突
1. 导出现有配置
2. 修改配置名称但保留 ID
3. 导入修改后的配置
4. 验证显示 ID 冲突
5. 选择覆盖
6. 验证配置被更新

### 测试 2: 域名冲突
1. 创建新配置，使用已存在的域名
2. 导出新配置
3. 导入配置
4. 验证显示域名冲突
5. 选择跳过
6. 验证保留原配置

### 测试 3: 混合冲突
1. 导入包含多个冲突的文件
2. 对不同冲突选择不同操作
3. 验证每个决定正确执行
4. 验证结果统计正确
