# 任务页改版设计（jobs redesign）

日期：2026-08-14
状态：已与用户对齐，待实现

## 背景与问题

现有 `/jobs` 页（`apps/web/src/pages/JobsPage.tsx`）功能齐全但信息架构混乱：

- 8 个启动按钮平铺无主次，重操作「全量归档」无确认直接开跑。
- 同一份结果摘要出现在横幅、状态行、任务列表三处。
- 游标/tid 等实现细节以裸文本糊给用户。
- 任务历史无筛选排序，成功记录同质堆积。
- 「刷新间隔」等内部机制泄漏到 UI。

## 目标形态

页面上半部：按任务类型的统计卡 + 「创建任务」主按钮。
页面下半部：支持后端分页、筛选、排序的任务表格。

## 一、后端：任务暂停/继续

实现方式：Runner 管线式 checkpoint（否掉 handler 内自旋轮询标志的方案——逻辑散落、空转、易漏）。

### JobRunner（`packages/core/src/jobs/runner.ts`）

- 每个运行中任务增加暂停句柄（内存态）：`pause(jobId)` 置暂停标记并把 DB `status` 写为 `paused`；`resume(jobId)` 写回 `running` 并唤醒挂起的 checkpoint；两者仅在任务当前处于对应状态时成功，否则返回 false（API 层据此回 409）。
- `stop` 对已暂停任务同样有效：abort 信号唤醒挂起的 checkpoint，任务按现有路径收尾为 `aborted`。
- 同类型互斥检查 `hasRunningOfType` 扩展：`paused` 算作占用中，暂停未恢复前不能开同类新任务。

### JobContext（`packages/core/src/jobs/handler.ts`）

新增 `checkpoint(): Promise<void>`：未暂停立即返回；已暂停则挂起，直到 resume 或 abort（abort 时抛出与现有 signal 一致的中断，走 `aborted` 收尾）。三个 handler（`archive_posts` / `archive_books` / `archive_auto_group`）在批处理循环（每页/每批）开头各加 `await ctx.checkpoint()`。暂停粒度为一页（约 1.5s），体感即时。

### 存储层（`packages/core/src/storage/`）

- `jobs.status` 合法值增加 `paused`（TEXT 列，无迁移）。
- `markStaleJobsInterrupted`（进程启动恢复）把残留的 `running` / `pending` / `paused` 一并标 `interrupted`。

### 重启行为（用户已确认）

暂停与运行态都不持久化执行现场。服务重启后：

- 运行中/暂停的任务显示「中断」。
- 归档任务通过游标手动续跑（游标每页写库，损失 ≤ 1 页）。
- 自动分组无游标，重头重跑（约 20-30s，幂等 upsert，无副作用）。
- **不做**启动自动续跑（用户明确否掉）。

### API（`apps/api/src/index.ts`）

- `POST /api/me/jobs/:id/pause`：非 running 409；不存在 404。
- `POST /api/me/jobs/:id/resume`：非 paused 409；不存在 404。
- 错误体与现有 jobs 路由一致（`{ error }`）。

## 二、后端：列表排序与批量删除

### 排序

`GET /api/me/jobs` 新增 query 参数：

- `sort`：`created_at`（默认）| `type` | `status` | `duration`
- `order`：`asc` | `desc`（默认 `desc`）

`duration` 为计算列：`COALESCE(finished_at, now_ms) - started_at`（进行中按当前时间），`started_at` 为 NULL 的行排最后。`sort` 值不在白名单时 400。`status` 排序按固定状态序（running > paused > pending > interrupted > failed > aborted > succeeded）保证语义可预期。

### 批量删除

`DELETE /api/me/jobs` 改为 body `{ ids: number[] }`（对齐 `/api/me/history` 批量模式）：

- 删除多条已结束任务 `{ ok, removed }`。
- ids 中含 running/paused/pending 的任务时整批 409 `job running`。
- 空 ids / 非法 body 400。
- 去掉「无 body 清空全部已结束」语义（前端不再提供清空入口）。
- 单条 `DELETE /api/me/jobs/:id` 保留不变。

## 三、前端：页面结构

### 顶部：统计卡 + 创建任务

- 三张统计卡，点击跳转对应页面：
  - 论坛归档 → `/archive`：库内条数、最新 tid、游标状态、最近一次结果摘要。数据 `GET /api/me/archive/status?site=1`。
  - 书库归档 → `/archive?site=2`：同构。数据 `?site=2`。
  - 自动分组 → `/groups`：组数、成员数、最近一次结果。组数取 `GET /api/me/groups?limit=1` 的 `total`；最近结果取 jobs 列表里最近一条 `archive_auto_group`。
- 右侧「创建任务」主按钮。页头动作保留「导出备份」「清空缓存」。

### 创建 modal（两步）

- 第一步：选类型，三张小卡（论坛归档 / 书库归档 / 自动分组）。
- 第二步：按类型出精简参数（站点已由第一步的类型选择隐含，v1 自动分组仅论坛）：
  - 归档类：模式——`incremental`（默认）、`full`（附耗时警示文案）、`resume`（仅当该站游标可续时可选，显示续跑位置）。
  - 自动分组：最少章节数（默认 2），site 固定为论坛。
- 确认即 `POST /api/me/jobs` 启动，关闭 modal，表格跳第一页。

### 任务表格（替代现有卡片列表）

- 列：复选框、状态徽章（新增「已暂停」，蓝灰系）、类型、参数摘要（站点 · 模式）、进度/结果、耗时、创建时间、操作。
- 排序：`created_at` / `type` / `status` / `duration` 四列表头点击排序，默认 `created_at desc`；排序与筛选写入 URL 参数（`?type=&status=&sort=&order=&page=`），可分享/刷新保持。
- 筛选：类型下拉（全部/论坛归档/书库归档/自动分组）、状态下拉（全部/运行中/已暂停/成功/失败/中断/已停止）。
- 分页：后端 `limit/offset`，沿用现有 Pager 组件。
- 行操作：
  - 跳转：归档任务 → `/archive?site=`（按 payload.site），自动分组 → `/groups`。
  - 展开日志（所有任务）。
  - running → 「暂停」「停止」；paused → 「继续」「停止」。
  - 删除（已结束任务，带确认）。
- 批量：勾选多行后工具栏出现「删除所选」（带确认，调 `DELETE { ids }`）；只允许勾选已结束任务。

### 日志面板

沿用 `JobLogPanel`（running/paused 自动滚动更新），新增级别筛选（全部 / warn+error），透传 API 已有 `level` 参数。

### 轮询

固定 1.5s；仅当当前页存在 running/paused 任务时静默刷新。移除「刷新间隔」下拉及 localStorage 持久化（`getPollMs`/`setPollMs`/`POLL_OPTIONS` 删除）。

### 移除项

- 「返回目录」链接（顶部导航已有）。
- 「最近一次归档成功」横幅与运行中横幅（状态并入表格与统计卡）。
- cursorHint 两行裸文本（并入统计卡）。
- 「清空已结束」按钮。
- 任务行 `#id` 展示。

### 保留项

- 任务结束 toast 与浏览器通知（含「已暂停」不计入结束通知）。
- 删除/批量删除/全量归档的确认框。
- 页码越界自动回退逻辑。

## 四、测试与验证

- `packages/core` 单测（`bun test`）：
  - runner：pause → resume → 正常完成；pause → stop → aborted；暂停中同类型 start 409；checkpoint 在未暂停时零开销直通。
  - storage：`paused` 状态读写；`markStaleJobsInterrupted` 覆盖 paused。
  - jobs 查询：sort/order 白名单、duration 计算与 NULL 处理、批量删除与运行中 409。
- 全仓：`bun run test` + `bun run typecheck` + `bun run build`。
- 手工验收：Chrome 访问任务页，走一遍创建 → 暂停 → 继续 → 停止 → 删除流程。

## 明确不做（YAGNI）

- 启动自动续跑中断任务（用户否掉）。
- 任务历史自动淘汰/保留上限。
- 日志关键词搜索。
- 创建 modal 高级参数（最大页数、起始页等）。
