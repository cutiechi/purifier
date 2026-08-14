# 任务页改版设计（jobs redesign）

日期：2026-08-14（同日按 review.md 修订）
状态：已与用户对齐 + review 修订，待实现

## 背景与问题

现有 `/jobs` 页（`apps/web/src/pages/JobsPage.tsx`）功能齐全但信息架构混乱：

- 8 个启动按钮平铺无主次，重操作「全量归档」无确认直接开跑。
- 同一份结果摘要出现在横幅、状态行、任务列表三处。
- 游标/tid 等实现细节以裸文本糊给用户。
- 任务历史无筛选排序，成功记录同质堆积。
- 「刷新间隔」等内部机制泄漏到 UI。

## 目标形态

页头：标题 + 「创建任务」主按钮 + 次要动作。
上半部：三张统计卡 + 固定「进行中」条。
下半部：后端分页、筛选、排序的任务表格（手机卡片 / 桌面表）。

布局约束（对齐 `2026-08-14-layout-review-design.md`）：手机 390px 与桌面 1280px 对半，两边都不妥协。

## 一、后端：任务暂停/继续

实现方式：Runner 管线式 checkpoint（否掉 handler 内自旋轮询标志的方案——逻辑散落、空转、易漏）。

### JobRunner（`packages/core/src/jobs/runner.ts`）

- 每个运行中任务增加暂停句柄（内存态）：`pause(jobId)` 置暂停标记并把 DB `status` 写为 `paused`；`resume(jobId)` 写回 `running` 并唤醒挂起的 checkpoint；两者仅在任务当前处于对应状态时成功，否则返回 false（API 层据此回 409）。
- `stop` 对已暂停任务同样有效：abort 信号唤醒挂起的 checkpoint，任务按现有路径收尾为 `aborted`。
- **paused 任务必须保留在 `running` Map 里**，`abortAll()`（进程关停）能唤醒它走 `aborted` 收尾，`waitForIdle` 不超时。
- 同类型互斥：`hasRunningOfType` 查询条件从 `status='running'` 扩为 `status IN ('running','paused')`。

### JobContext（`packages/core/src/jobs/handler.ts`）

新增 `checkpoint(): Promise<void>`：未暂停立即返回；已暂停则挂起，直到 resume 或 abort（abort 时抛出与现有 signal 一致的中断，走 `aborted` 收尾）。

checkpoint 插入位置**跟随各 handler 现有让出点**，不是统一的「一页」：

- `archive_posts` / `archive_books`：每页循环开头（现有 signal 检查处）。
- `archive_auto_group`：无翻页，两段循环——扫库每 100 条的 `sleep(0)` 处、upsert 每 3 组的让出处，checkpoint 与让出点同行放置。

### 存储层（`packages/core/src/storage/store.ts`）

- `jobs.status` 合法值增加 `paused`（TEXT 列，无迁移）。
- 新增 `markResumed(id)`：`UPDATE … SET status='running' WHERE id=? AND status='paused'`，**不改写 `started_at`**（暂停时长计入总耗时，与表格「耗时」列、`sort=duration` 一致）。不复用 `markRunning`（那是 `WHERE status='pending'` 且写 `started_at`，语义不同）。
- `setJobResult` 保持 `AND status='running'`：paused 期间无进度写入，恢复后继续，无需改。
- `markStaleJobsInterrupted` 的 `IN ('running','pending')` 扩为 `IN ('running','pending','paused')`（jobs 与 archive_cursors 两处，游标那处本就含 running 残留处理，保持）。

### API（`apps/api/src/index.ts`）

- 子资源路由正则从 `(?:\/(logs|stop))?` 扩为 `(?:\/(logs|stop|pause|resume))?`。
- `POST /api/me/jobs/:id/pause`：仅 running 可暂停；非 running 409 `cannot pause job in status: …`；不存在 404。
- `POST /api/me/jobs/:id/resume`：仅 paused 可恢复；非 paused 409；不存在 404。
- `POST /api/me/jobs/:id/stop`：接受 `running | paused`，其余 409（现状只接受 running，需改）。
- 单条 `DELETE /api/me/jobs/:id`：终态白名单 `succeeded | failed | interrupted | aborted` 可删；`running | paused | pending` 409（现状只拦 running，需改；否则删掉 paused 行后 handler 醒来 `markFinished` 打空行、类型互斥出现释放空窗）。

### 重启行为（用户已确认）

暂停与运行态都不持久化执行现场。服务重启后：

- running/paused/pending 的任务被 `recoverOnStartup` 标 `interrupted`。
- 归档任务通过游标手动续跑（游标每页写库，损失 ≤ 1 页）。
- 自动分组无游标，重头重跑（幂等 upsert，无副作用）。
- **不做**启动自动续跑（用户明确否掉）。

## 二、后端：列表查询与批量删除

### 排序与筛选

`GET /api/me/jobs` 新增/扩展 query 参数：

- `sort`：`created_at`（默认）| `type` | `status` | `duration`；不在白名单 400。
- `order`：`asc` | `desc`（默认 `desc`）。
- `status` 新增聚合值：
  - `active` = `running | paused | pending`（供前端「进行中」条一次拉取）。
  - `finished` = `succeeded | failed | interrupted | aborted`（供统计卡取「最近一次结果」，见下）。
  - 其余单值语义不变。
- **`listJobs` 与 `countJobs` 必须共用同一套 status 条件**（聚合值展开为 `IN (…)`，单值仍等值）；现状两处独立写 `status = ?2`，只改 list 不改 count 会让 `active`/`finished` 的计数恒 0。
- `duration` 为计算列：`COALESCE(finished_at, now_ms) - started_at`（进行中按当前时间），`started_at` 为 NULL 排最后。注明：进行中任务的 duration 随时间变化，排序位置不稳定，可接受。
- `status` 排序按固定状态序（running > paused > pending > interrupted > failed > aborted > succeeded）。

### 批量删除

`DELETE /api/me/jobs` 改为 body `{ ids: number[] }`（对齐 `/api/me/history` 批量模式）：

- 删除多条已结束任务 `{ ok, removed }`。
- ids 中含 running/paused/pending 的任务时整批 409 `job running`。
- 空 ids / 非法 body 400。
- 去掉「无 body 清空全部已结束」语义（前端不再提供清空入口）。

## 三、前端：页面结构

### 页头

- `PageHeader` action 区：「创建任务」主按钮（实心）+ 「导出备份」「清空缓存」次要（描边/文字）。`<sm` 时 PageHeader 本就上下堆叠，主按钮随 action 区置顶，不会沉底。
- 移除：「返回目录」链接、「刷新间隔」下拉（连同 `getPollMs`/`setPollMs`/`POLL_OPTIONS` 删除，轮询固定 1.5s）。

### 统计卡（`grid-cols-1 gap-3 sm:grid-cols-3`，整卡为 Link）

视觉对齐 `StatsPage` 的 `StatCard`（`rounded-2xl border … bg-card/80`）。每卡固定结构：主数字 + 辅文 + 状态行（有活动任务时优先显示活动态）。**不展示 tid、游标值、游标 raw status**。

| 卡（点击跳转） | 主数字 | 辅文 | 状态行 |
| --- | --- | --- | --- |
| 论坛归档 → `/archive` | 库内 N 条 | 上次：新增 x · 更新 y；或「还没跑过」 | 进行中 / 已暂停 / 可从中断处接着扫 / 已扫完 |
| 书库归档 → `/archive?site=2` | 库内 N 条 | 同上（不显示 tid） | 同上 |
| 自动分组 → `/groups` | 组数 G | 上次：G 组 · M 成员；或「还没跑过」 | 进行中 / 已暂停 |

数据源（**独立拉取，不复用带筛选的表格响应**）：

- 库内条数：`GET /api/me/archive/status?site=1|2` 的 `total`（该接口无 lastJob，不指望它）。
- 组数：`GET /api/me/groups?limit=1` 的 `total`。成员总数不做（现有接口无此数据，辅文里的成员数来自上次任务 result）。
- 上次结果：每类型独立 `GET /api/me/jobs?type=<type>&status=finished&sort=created_at&order=desc&limit=1`（**sort/order 写死**，禁止复用表格 URL 上的排序参数，否则会拿到「最短的一次」而非最近一次）。只查 succeeded 会把「刚失败过」显示成「还没跑过」，故取最近一条终态任务：
  - succeeded → 「上次：新增 x · 更新 y」（自动分组：「上次：G 组 · M 成员」）。
  - failed / interrupted / aborted → 「上次未完成」。
  - 无任何终态 → 「还没跑过」。
- 「可从中断处接着扫」内部判定：`cursor.next_mtid` 存在且 `cursor.status !== 'done'`（**统一用这一条**，删掉现有 `canResume` / `resumeEnabled` 两套逻辑）；且该类型当前无 running/paused。UI 不展示游标数值。

### 「进行中」条（表格上方，固定，不受 type/status/page 筛选影响）

- 数据：`GET /api/me/jobs?status=active&limit=10`。
- 每条显示：类型、进度摘要、暂停/继续/停止快捷按钮、展开日志。操作都在条内完成，不依赖表格当前筛选状态；创建 modal 的「占用提示」也指回此条（高亮对应任务）而非表格行。
- **active 任务的操作只归本条**：默认「全部」视图下 active 任务会同时出现在本条和表格里，表格对 active 行只做展示（状态徽章 + 进度），行内不重复渲染暂停/继续/停止，避免两套操作入口。
- 创建成功：关闭 modal、刷新「进行中」条与统计卡；表格不强制跳回第 1 页。
- 轮询条件：**实例内存在 active 任务**（即本条非空），与当前页表格内容无关——否则筛掉 running 或翻到后页时轮询停转、暂停入口消失、结束 toast 失效。
- 结束 toast 判定比较 **active 集合**（running|paused|pending）：`running → paused` 不算结束、不通知；active 集合清空才算结束（修正现有 `prevRunningRef` 只看 running 的语义）。

### 创建 modal（两步）

- 第一步：选类型，三张小卡 `grid-cols-1 sm:grid-cols-3`，选中描边（论坛归档 / 书库归档 / 自动分组，文案与 `JOB_TYPE_LABEL`、表格、筛选项统一改齐，不保留「全站主帖归档」旧词）。
- 第二步（站点已由类型隐含，v1 自动分组仅论坛）：
  - 归档类：模式用 `SegmentedControl`——增量（默认）/ 全量 / 续跑。「续跑」仅当该站游标可续时可选，提示用人话「从中断处接着扫（已记 N 页）」（只用 `cursor.pages`，**不展示 `next_mtid`**——论坛是 tid、书库是页码，都是实现细节）；全量出耗时警示文案。
  - 自动分组：最少章节数数字输入，范围 2–50（与 handler clamp 一致），超界前端拦截。
- **占用处理**：v1 保持**全局一把锁**——实例内任一 running/paused 任务存在时，第二步不给「启动」，显示「已有任务进行中 / 已暂停」+ 按钮定位到该任务（后端 type 级互斥仅防双开同类）。
- 文案区分两种「继续」：表格行「继续」= 恢复暂停的同一条任务；modal「续跑」= 从目录游标接着扫（新任务）。
- 交互：遮罩点击 / Escape / 取消可关；提交中按钮 disabled 防双 POST；全量归档确认框保留；modal 基础交互（焦点、Esc）与 `ConfirmDialog` 同一套，不另起半残实现。

### 任务表格（替代现有卡片列表）

**响应式分叉**：

- `<sm`：退回卡片行（复用现 `JobRow` 的折行布局）——复选框 + 状态徽章 + 类型 + 一行摘要 + 操作收进 `…` 菜单。不横向滚八列。
- `sm+`：真表格。默认可见列：复选框、状态、类型、进度/结果、耗时、操作；参数摘要、创建时间 `hidden lg:table-cell`。

列定义（桌面）：复选框、状态徽章（新增「已暂停」）、类型、参数摘要（站点 · 模式）、进度/结果、耗时、创建时间、操作。

- 排序：仅 `created_at` / `type` / `status` / `duration` 四列表头可点（进度/结果、参数列不可排序）；默认 `created_at desc`。
- 筛选：类型下拉、状态下拉（全部/运行中/已暂停/成功/失败/中断/已停止；**不提供 pending**——它只存在于创建瞬间的过渡态）。
- URL 参数：`?type=&status=&sort=&order=&page=`；type/status/sort/order 变化时 page 重置为 1；页码越界自动回退保留。
- 分页：后端 `limit/offset`，沿用 `Pager`。
- 行操作：
  - 跳转：归档任务 → `/archive?site=`（按 `payload.site`；`succeeded | running | paused` 均可跳，修正现 `JobRow` 只认 succeeded/running）；自动分组 → `/groups`。
  - 展开日志（所有任务）：表格用整行 accordion（`<tr>` 下 `colSpan` 附行），手机卡片区为内嵌展开；不开新路由。
  - running → 「暂停」「停止」；paused → 「继续」「停止」。
  - 删除（仅已结束任务，带确认）。
  - 手机端全部行操作收进 `…` 菜单；桌面图标+文字，最多 2–3 个常驻，其余进 `…`。
- 批量：勾选仅对已结束行开放（活动行复选框禁用）；全选只作用于当前页已结束行，不跨页。勾选后 sticky 批量条「删除所选 (n)」，确认走现有 `ConfirmDialog`。

### 日志面板

沿用 `JobLogPanel`（running/paused 均自动轮询/贴底）。级别筛选为三档**精确匹配**——全部 / warn / error（现有 API `level` 参数是等值匹配，`warn` 不含 error，不假装它是 `warn+`）。

### 移除项（汇总）

- 「返回目录」链接、「最近一次归档成功」横幅、运行中横幅（职责并入「进行中」条与统计卡）、cursorHint 裸文本、「清空已结束」按钮、「刷新间隔」下拉、任务行 `#id`。
- `formatJobProgress` 的「游标 nextMtid」段（`jobs.ts` 中 `nextMtid` 三行）：游标值是给排查用的实现细节，进度列、进行中条、结束 toast 一律不出；页数、新增、更新、组/成员保留。

### 保留项

- 任务结束 toast 与浏览器通知（按 active 集合判定，见上）。
- 删除/批量删除/全量归档确认框；页码越界回退。

## 四、改动面清单

- 后端：`packages/core/src/jobs/runner.ts`、`handler.ts`、`handlers/archive_posts.ts`、`handlers/archive_books.ts`、`handlers/archive_auto_group.ts`、`packages/core/src/storage/store.ts`（+ `db.ts` 注释若涉及）、`apps/api/src/index.ts`（jobs 分支、路由正则、错误映射）。
- 前端：`apps/web/src/pages/JobsPage.tsx`（重写）、`apps/web/src/components/job-row.tsx`（改造为表格行/卡片行）、`apps/web/src/components/job-log-panel.tsx`、`apps/web/src/lib/jobs.ts`（`JobStatus` 加 `paused`、`STATUS_LABEL`、`JOB_TYPE_LABEL` 改词、新增 pause/resume/批量删除/排序参数、删轮询持久化）。
- 文档：`AGENTS.md` 的 jobs API 表（`DELETE /api/me/jobs` 语义变更、pause/resume、sort/order、status=active）。

## 五、测试与验证

`packages/core` 单测（`bun test`）：

- runner：pause → resume → 正常完成；pause → stop → aborted；paused + `abortAll` → aborted 且 `waitForIdle` 不超时；暂停中同类型 start 409；checkpoint 未暂停时直通。
- storage：`markResumed` 仅 `paused → running` 且不改 `started_at`；`hasRunningOfType` 含 paused；`markStaleJobsInterrupted` 覆盖 paused；`setJobResult` 在 paused 下不写、resume 后可写。
- jobs 查询：sort/order 白名单与 400；duration 计算与 NULL 末位；`active`/`finished` 聚合的 list 与 **count 一致**；批量删除与运行中整批 409。
- 状态矩阵（core 层 runner + store，不新起 `apps/api` 测试脚手架——仓库约定测试只在 `packages/core`）：running/paused/终态 × pause/resume/stop/单删；路由正则扩展靠 typecheck 与手工验收覆盖。
- 日志：level 精确匹配维持现状的用例。

全仓：`bun run test` + `bun run typecheck` + `bun run build`。

手工验收：

- 手机 390px 与桌面 1280px 各走一遍：创建 → 暂停 → 继续 → 停止 → 删除。
- 筛选掉 running（如 `?status=succeeded`）后，「进行中」条仍可见可操作、轮询仍在转、结束 toast 仍响。
- 有 paused 任务时打开创建 modal：不出现可点的「启动」，且不产生 409。
- 重启服务：paused/running 变「中断」，归档任务可从游标续跑。

## 明确不做（YAGNI）

- 启动自动续跑中断任务（用户否掉）。
- 任务历史自动淘汰/保留上限；跨页批量选择。
- 日志关键词搜索；`minLevel`/多值日志级别。
- 创建 modal 高级参数（最大页数、起始页等）。
- 三任务并行（v1 全局一把锁；type 级互斥仅后端兜底）。
- 统计卡成员总数（现有接口无此数据）。
