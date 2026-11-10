# 项目审核与修复记录

> 本文“结论”至“兼容性与覆盖限制”记录的是审核结束时的历史状态；后续发布准备的实际处理和验证以文末补充为准。

## 结论

1. 已完成获批范围的 **14 项缺陷修复和 2 项优化**（AUD-001～AUD-016），并通过对应回归和最终集成检查。
2. 全量 **58 个测试文件、814 项测试全部通过**；比审核前新增 158 项回归，原有覆盖率阈值未降低。
3. 在隔离 Chrome for Testing `147.0.7727.57` 中，生产扩展 **20/20 项浏览器检查通过**，包括真实报告无自动第三方请求、后台日志写入/清理和提取持久化闭环。
4. **仍不满足发布条件：AUD-017 依赖安全门禁失败。** 当前 Zod 命中高危公告，升级依赖不在获批实施范围内，未执行升级或忽略告警。
5. 保留已有业务改动；没有提交、打标签、发布或更改依赖与锁文件。

## 基线与边界

- 审核基线：`e19d4ac9ee4c1fb9a7b024dc6a8b11dd79f2d3d4` 加审核开始时的工作区改动；扩展版本 `0.9.0`。
- 开始时有 26 个已修改的跟踪文件和 1 个未跟踪文件。修复基于现状增量进行；不声称全部问题由这些未提交修改引入。
- 用户先要求审核和计划，随后批准实施。当前修复仍在未提交工作区，HEAD 未变，没有可引用的修复提交号。
- 已梳理扩展入口与交付配置，追踪提取/回复、AI 流式调用、设置与凭证、任务恢复/取消、IndexedDB、历史报告和日志；选用扩展宿主、Web 前端、AI、数据管道方向的审查参考。
- 受控复现和回归使用内存 DOM、模拟存储/网络、fake-indexeddb 或隔离浏览器配置；没有使用真实 AI 凭据或调用真实提供商。

## 修复前检查

以下命令在项目根目录执行；环境为 Windows、Bun `1.4.4`、Node `24.22.2`。

| 命令                                                                    | 实际结果                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| `bun run typecheck`                                                     | 退出 1；两处 executor 返回类型含 `undefined`       |
| `node ./node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 退出 1；同样两处类型错误                           |
| `bun run test --maxWorkers=2`                                           | 58 个测试文件；649 通过、7 失败，共 656 项         |
| `bun run lint`                                                          | 退出 1；162 个 Prettier 错误，后续 i18n 步骤被短路 |
| `bun run i18n:check`                                                    | 退出 0；5 种语言、421 个键一致                     |
| `bun run version:check`                                                 | 退出 0；版本一致                                   |

7 个失败用例来自日志旧传输断言（3）、动态报告旧 mock（2）、规则生成成功样本缺少 username（1）、AI bridge 计时未计消息开销（1）。修复没有通过放宽产品验证、跳过用例或延长全局超时来制造通过。

## 已确认缺陷与修复

### AUD-001｜P1｜已验证修复：任务执行器类型不闭合

- **位置：**[analysis.ts](../src/background/handlers/analysis.ts)，`handleStartAnalysis` 和 `handleGenerateDynamicReport` 的 executor catch。
- **证据：**原分支仅调用对象方法 `deadline.rethrow()`，TypeScript 仍推断出可能返回 `undefined`，实际类型检查失败。
- **修复：**显式 `return deadline.rethrow(error)`，保持 `TaskExecutor` 必须返回 `Promise<TaskResult>`，不弱化类型。
- **验收：**源代码及测试工程严格类型检查、生产构建通过。

### AUD-002｜P1｜已验证修复：模型 Markdown 图片自动外联

- **位置：**[HistoryDetailPanel.tsx](../src/history/components/HistoryDetailPanel.tsx) 的 Markdown 渲染；[manifest.json](../src/manifest.json) 的扩展页 CSP。
- **触发与影响：**模型返回远程图片语法后，旧渲染器生成真实 `<img>`，打开报告便可能向非用户所选端点发请求；URL 可以携带报告内容。动态 HTML 沙箱不能保护这一独立通道。这不是脚本 XSS。
- **修复：**Markdown 图片转为替代文字，扩展页限制 `img-src 'self' data: blob:`；保留用户明确点击的文本链接和原有危险协议/raw HTML 防护。
- **验收：**真实组件回归和生产浏览器报告页请求拦截均通过，远程图片、原始 HTML、JavaScript 链接不产生主动内容或自动 HTTP(S) 请求。

### AUD-003｜P1｜已验证修复：跨设置页的凭证与端点错配

- **位置：**[SettingsStore.ts](../src/background/storage/SettingsStore.ts) 的保存锁与合并；[useSettings.ts](../src/options/hooks/useSettings.ts) 的自动保存；[内部消息](../src/types/messages.ts) 和 [ExtensionAPI](../src/utils/extension-api.ts)。
- **复现：**A/B 两页持有 E1，A 导入 E2 并清 key，B 的旧 key-only patch 晚到，原实现把 E1 的 key 合并到 E2。使用真实 Store 和内存存储复现。
- **修复：**端点、key 和 UI model-only 编辑携带来源 `expectedAiEndpoint`；后台同一锁、同一次 fresh storage read 中规范化比较，拒绝陈旧编辑。换端点时丢弃旧端点的待保存 key；首次空端点、等价 URL 和随后输入的新 key 保持可用。
- **消息闭环：**[error-types.ts](../src/utils/error-types.ts) 仅白名单传输 `messageKey`，让实际消息中的冲突可在 UI 本地化；不传任意 `details`、凭证或诊断对象，保留旧错误结构兼容。
- **验收：**旧 key、旧 URL、旧 model 补丁、锁内交错、保存失败后的补丁合并及真实错误 encode/decode 回归通过。

### AUD-004｜P1｜已验证修复：恢复任务取消后卡住队列

- **位置：**[TaskManager.ts](../src/background/TaskManager.ts) 的恢复、取消、终结和 `processQueue`；[extraction.ts](../src/background/handlers/extraction.ts)。
- **复现：**持久 running 快照初始化为 interrupted，迟到 completion 恢复任务，归一化等待时取消；原 `currentTaskId` 留在已取消任务，下一任务一直 pending。
- **修复：**用执行链 taskId 明确 executor-finally 所有权；恢复 completion 拥有受管理的取消信号。无执行链者取消时释放匹配槽，普通执行器仍等待 finally；恢复消息不抢占或清除新任务槽。
- **验收：**真实 TaskManager、模拟持久状态和受控 normalizer 门闩覆盖恢复→取消→下一任务完成，以及新活动任务与恢复 completion 并存。

### AUD-005｜P1｜已验证修复：Reddit 第一层回复遗漏

- **位置：**[ConfiguredStrategy.ts](../src/content/strategies/ConfiguredStrategy.ts) 的回复候选与父项归属；[内置规则](../src/config/default_rules.json) 保持不变。
- **复现：**回复 container 和 item 都匹配 `shreddit-comment`，原逻辑先取子回复当容器，再只查其后代。两层样本只得到父评论；三层样本得到父评论和孙回复，却漏掉子回复。
- **修复：**收集多个回复容器，局部包含“容器自身也是 item”的情况，再按最近父项递归归属并去重；不改变共享选择器 helper 的默认自身排除语义。
- **验收：**未修改的 Reddit 规则，两/三层及兄弟回复、多/重叠容器、CSS、相对 XPath 和开放 Shadow DOM 回归通过。

### AUD-006｜P2｜已验证修复：慢连接测试复活已删除 key

- **位置：**[AIService.ts](../src/background/AIService.ts) 的验证缓存；[misc.ts](../src/background/handlers/misc.ts) 的 `handleTestModel`。
- **复现：**测试旧配置未返回时用户保存删除 key，旧成功回包又缓存该 key；后续空 key 调用隐式回退，实际仍带 Authorization。
- **修复：**测试在任何 await 前捕获验证 epoch，成功保存/导入使旧 epoch 失效；晚到测试不能重新授权。持久化失败时保留原有效缓存。
- **验收：**真实 AIService + handlers 和受控 fetch 覆盖 save/import 成功、失败与晚到测试，不调用真实提供商。不要求撤销已经发送的请求或已经开始的任务。

### AUD-007｜P2｜已验证修复：取消确认后仍写历史

- **位置：**[主分析](../src/background/handlers/analysis.ts)、[提取完成处理](../src/background/handlers/extraction.ts)、[HistoryStore.ts](../src/background/storage/HistoryStore.ts) 的 create/update。
- **证据：**原 handler 在取消检查后仍有异步读取和写入，普通存储 API 不接收 signal；可以在取消已确认后覆盖报告或新建历史。
- **修复：**任务写入传可选 signal，在同一 Dexie rw 事务的异步边界检查并抛取消错误，使历史、元数据和清理操作共同回滚；主分析重读后也重查信号，不先修改读出的对象。
- **验收：**fake-indexeddb 真实事务门闩覆盖读后、写后、最终 await 后取消；旧分析和元数据不变，新行不残留。事务提交后才到达的取消不倒撤合法结果。

### AUD-008｜P2｜已验证修复：后台系统日志未持久化

- **位置：**[后台入口](../src/background/index.ts)、[Logger](../src/utils/logger.ts)、[LogStore](../src/background/storage/LogStore.ts)。
- **证据：**原本没有调用已有的 `setStorageWriter`；后台只能向自身发送 APPEND，而 [Chrome runtime.sendMessage](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendMessage) 不回送发送上下文。这是漏日志，不是无限递归。
- **修复：**后台首条可持久化日志前绑定本地 writer，UI/content 继续消息委托；跳过日志传输消息自身的 debug 记录。
- **验收：**注册顺序、真实委托、开发者模式关闭、不自发 APPEND、失败不递归回归通过；浏览器中已读到由后台处理器产生的真实诊断记录。

### AUD-009｜P2｜已验证修复：日志删除/清空绕过单写入口

- **位置：**[useLogs.ts](../src/logs/hooks/useLogs.ts)、[Logs.tsx](../src/logs/Logs.tsx)、[LogStore](../src/background/storage/LogStore.ts) 和 [MessageRouter](../src/background/MessageRouter.ts)。
- **证据：**UI 原先读改写旧索引，可覆盖并发新增日志；清空只删上次已加载的行和索引，留下新行/孤儿。
- **修复：**UI 使用已有 DELETE_LOG/CLEAR_LOGS，成功确认后才更新状态；后台统一互斥、扫描清孤儿。拒绝删除日志级别设置；失败保留行并显示本地化 alert，不留下点击事件的未处理 rejection。
- **验收：**真实 Store 门闩、跨分类互斥、ack 前 UI 不变、失败/重试、孤儿清理及设置/token/log-level 保留均通过，生产浏览器也验证了清理闭环。

### AUD-010｜P2｜已验证修复：失败导入挂起未保存编辑

- **位置：**[useSettings.ts](../src/options/hooks/useSettings.ts) 的导入、generation 和 debounce 保存。
- **证据：**导入失败仍使旧保存回调失效，未保存修改继续显示在表单，却不再自动持久化。
- **修复：**选择文件即暂停，失败显式恢复 dirty 保存；等待在途保存后导入，成功清除旧 patch；处理读取失败、abort、同步异常及同文件重试。
- **验收：**无需再次输入即可恢复失败导入前的编辑；成功导入不被旧 patch 重放覆盖。

### AUD-011｜P2｜已验证修复：空可选展开规则阻止保存

- **位置：**[CrawlingConfigEditor.tsx](../src/options/components/CrawlingConfigEditor.tsx)、[ConfigSettings.tsx](../src/options/components/ConfigSettings.tsx)。
- **证据：**新回复规则强制带空 expandBtn，但现有 schema 要求提供的 selector 非空、expandBtn 本身可省略；保存后才被后台拒绝。
- **修复：**空可选规则归一为省略；保存前复用现有 schema，无效草稿留在编辑器、不进入全局待保存 patch，不降低后台验证。
- **验收：**真实编辑器的无展开按钮规则、填写后清空、空必需 selector 和本地错误反馈回归通过。

### AUD-012｜P2｜已验证修复：旧模型响应覆盖当前设置

- **位置：**[AIModelSettings.tsx](../src/options/components/AIModelSettings.tsx)、[useSettings.ts](../src/options/hooks/useSettings.ts)。
- **证据：**E1 的慢模型列表可写入当前 E2 模型；旧列表不失效，也可能使用户困在旧下拉中。
- **修复：**按规范化端点、key、请求代际与用户模型编辑版本核对结果；身份改变清列表，失败/空结果恢复手输。model-only UI patch 同样绑定来源端点，防跨页错配。
- **验收：**乱序、ABA、旧错误、切凭证、期间手输及 model-only CAS 回归通过。

### AUD-013｜P2｜已验证修复：虚拟列表复用节点漏提取

- **位置：**[ConfiguredStrategy.ts](../src/content/strategies/ConfiguredStrategy.ts) 的处理版本缓存。
- **复现：**同一 DOM 节点先显示 first、滚动后显示 second，原 WeakSet 只允许处理一次。空骨架也会被提前标记。
- **修复：**按身份、字段和回复子树版本记录成功结果；空 content（包括仅作者先出现）不消耗目标。保留缺 username 的 unknown fallback，未变化项不重复点击。
- **验收：**节点复用、骨架补全、提取期间字段变化和未变化 root/reply 不重点击回归通过；未做性能测速。

### AUD-014｜P2｜已验证修复：深层回复搜索丢失祖树

- **位置：**[History.tsx](../src/history/History.tsx) 的 `filterComments`。
- **证据：**原逻辑在递归前仅检查直接回复，只有孙回复匹配时父树已被过滤。
- **修复与验收：**先递归子树，再按自身或子树匹配保留必要祖先；三层 username/content/timestamp 搜索回归通过。

## 已完成优化

### AUD-015｜P2｜已验证：达到目标后停止无效工作

[提取循环](../src/content/strategies/ConfiguredStrategy.ts) 原本处理完整批 DOM 后才判断目标；受控样本请求 1 条却处理 6 个元素。现在达到调用方传入的根评论目标即停，保留上层校验缓冲。回归验证目标 1/3/含缓冲的 11 分别只处理 1/3/11 个条目；不据此承诺未经测量的速度提升。

### AUD-016｜P3｜已验证：设置加载失败可见、可重试

[Options](../src/options/Options.tsx) 和 [useSettings](../src/options/hooks/useSettings.ts) 提供明确加载错误、重试、始终挂载的 toast；新增文案同步五种语言。首次失败后成功重试、不覆盖 dirty 编辑及跨页更新回归通过。存储事件没有 writer 身份，保存结束时仍 dirty 的场景采用保守潜在冲突提示，可能包含自身写入；安全保证来自后台 CAS，不依赖这个提示。

## 新发现的交付阻塞：AUD-017

**状态：open；安全门禁失败已确认，具体应用可利用性尚待验证。依赖升级不在获批实施范围内。**

`bun run audit`（`bun audit --prod --audit-level=high`）退出 1，命中安装中的 Zod `3.23.8`，输出还列出 Puppeteer/Chromium BiDi 的 Zod 路径。公告为 [GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。[GitHub 官方结构化公告](https://api.github.com/advisories/GHSA-mrhx-c7xc-m3w5) 将 `<4.6.6` 列为受影响版本，首个修复版本为 `4.6.6`，描述为超大集合验证时累积错误导致内存耗尽。

- **已确认：**当前安装版本被官方公告覆盖，原有安全门禁实际失败。
- **尚未建立：**当前扩展的某一真实网页能独立利用该问题导致内存耗尽；没有进行大输入崩溃测试，不据扫描器等级宣称网页 RCE。
- **当前处置：**不执行 `audit fix`，不更改依赖、锁文件或门槛，不将该风险标记为接受。

### 后续最小修复计划（未实施）

1. 单独授权依赖变更后，核对 Zod v3→修复版本的 schema API、输出类型、默认值和错误结构，以及直接/传递依赖的实际解析器版本。
2. 迁移到包含实际修复的版本（公告首个为 `4.6.6`），只改必要依赖与锁文件，不以忽略告警、只改版本号或降低校验掩盖问题。
3. 保留所有存储旧形状、消息边界、URL/数值限制、错误传输与本轮 814 项回归；新增有资源上限的集合验证回归，不做真实崩溃攻击。
4. 重跑审计、类型、lint、覆盖率、构建和隔离浏览器 E2E。高危门禁通过前不得宣称可以发布。

## 最终验证

在全部队友停止写入的代码上完成整合检查；最后一处原工作区格式遗留仅作等价格式修正。

| 命令 / 检查                            | 实际结果                                        |
| -------------------------------------- | ----------------------------------------------- |
| `bun run version:check`                | 退出 0；`0.9.0` 一致                            |
| `bun run format:check`                 | 退出 0；全项目格式通过                          |
| `bun run typecheck`                    | 退出 0；源代码和测试严格类型通过                |
| `bun run lint`                         | 退出 0；ESLint 及 5 种语言、423 个键一致        |
| `bun run test:coverage --maxWorkers=2` | 退出 0；58 个文件、814/814 通过；原全局阈值通过 |
| `bun run audit`                        | 退出 1；AUD-017，未绕过或降低门禁               |
| `bun run build`                        | 退出 0；TypeScript + Vite 生产构建通过          |
| `bun run test:e2e`                     | 退出 0；Chrome for Testing 147，20/20 检查通过  |
| `git diff --check`                     | 退出 0                                          |
| 依赖和锁文件差异                       | 无；未提交、未发布                              |

V8 全局测量：**语句 75.44%、分支 65.33%、函数 75.97%、行 76.51%**。这是本次实际覆盖率，不是审核前后提升比例或安全评分。

浏览器使用临时配置、本地评论页面和模拟报告，无真实密钥。验证了真实报告渲染而非仅列表：图片替代文字存在、无真实 img/raw HTML/script、危险链接无效、普通链接需用户操作，且报告页没有自动 HTTP(S) 请求。另验证后台日志本地 writer、清除索引与孤儿且保留用户设置/用量，以及真实 `START_EXTRACTION`→内容脚本→历史持久化读取。

## 兼容性与覆盖限制

- 没有更换框架、数据库、AI 协议或权限，没有升级依赖或降低任何门槛。
- 保留现有 storage key、Dexie 表名/索引及旧数据可读；本轮新增的是内部条件写入元数据、可选 signal 和安全错误翻译字段，不需要破坏持久化格式。
- 主评论 container 继续使用原先首匹配语义，最大数按根评论计；回复保留原 `MAX_REPLY_DEPTH`。没有扩展相对 XPath 跨 Shadow 或闭合 Shadow 支持。
- 真实提供商/模型质量、全部线上站点、最低 Chrome 116、配额/磁盘故障及真实浏览器自动休眠时序未实测。恢复/取消时序以受控持久状态、门闩及真实事务回归验证，不能替代所有平台时序。
- 没有访问或更新 Chrome Web Store Dashboard，也没有生成发布或合规批准。审核结束时仍因 AUD-017 不具备通过全部发布门禁的证据。

## 发布准备补充（2026-11-10）

- 生产依赖已从 Zod `3.23.8` 升级为 `4.6.7`，实际使用 v4 校验引擎；设置 `jitless` 保持原有扩展 CSP，未使用 `zod/v3` 兼容入口。消息与设置写入增加数组、对象、总条目和深度预算，超限在校验前拒绝；历史存储读取未加这些限制，因此旧数据不会因新预算被静默删除。超大旧数据的重新分析或修改可能被拒绝，需先缩小输入。
- Bun `1.3.11` 的 `audit --prod` 仍会报告仅由开发依赖引入的 Zod v3；Bun `1.4.4` 按生产依赖图执行该检查。CI 与发布流程已统一固定为 `1.4.4`，未加入忽略项或降低严重性阈值。该版本的 `bun run audit` 检查 113 个生产包，结果无告警。
- 在 Windows、Bun `1.4.4`、Node `24.22.2` 上，冻结锁文件安装、版本检查、格式、类型、lint、覆盖率、生产审计、打包均通过；覆盖率测试 **59 个文件、822 项通过**，Chrome for Testing `147.0.7727.57` 的浏览器 E2E **21/21 通过**，包括 Options 页无 CSP 阻止的动态代码探测。以上是在升级扩展版本之前执行的检查。
- 使用隔离 Chrome for Testing 配置，以官方 `0.7.0` 发布 ZIP 写入合成旧设置、加密凭证、规则、Token 统计和 IndexedDB 历史；替换为 `0.9.1` 解包构建并显式重载扩展后，数据版本从 2 升至 4，两次启动均保留这些数据。首次直接替换文件时 Chrome 仍执行缓存的旧后台脚本，因此不能把未重载的结果当作候选版本的迁移结果；此检查也不等同于 Web Store 签名自动更新。
- **剩余供应链风险：**额外执行的全依赖图高危审计仍失败，报告 39 条高危版本范围记录、34 个不同公告，涉及构建和测试工具，包括 Puppeteer 的 `chromium-bidi` 使用的 Zod `3.25.76` 以及 `extract-zip`。这些开发依赖不属于现有生产审计范围，但部分参与构建或浏览器安装，不能据生产审计通过就宣称构建链完全无风险；其中浏览器压缩包被替换时的文件写入风险尚无实测利用。没有忽略或宣称修复这些告警。
- 本地测试未覆盖全部线上站点、真实模型提供商、Chrome 116、Web Store 签名更新或私有 Dashboard 中的状态与声明。自动化生产审计只覆盖生产依赖，不代表对全部开发依赖的风险接受或 Web Store 合规批准。
