# 二手车投放综合工作台接入说明

## 模块名称

供应商评论维护工作台（模块标识：`comment-monitor-dashboard`）

## 模块简介

本模块将聚光投放表现和蒲公英评论数据转换为每日供应商笔记评论维护任务，按 P0/P1/P2 展示优先级，并支持任务认领、审核、铺设、防车商、官方回复、复查、完成/跳过、操作留痕、富文本备注和图片材料。

- 核心功能：每日任务清单、优先级排序、多人协作、任务状态、操作事件、图片上传、数据同步。
- 使用场景：投放团队每天筛选高消耗或高评论笔记，分配供应商评论维护工作并跟踪完成情况。
- 目标用户：二手车投放运营、评论维护供应商、项目负责人和复核人员。

## 启动方式

| 项目 | 内容 |
| --- | --- |
| 项目目录 | `used-car-workbench-module-comment-monitor-dashboard` |
| 安装依赖 | Windows：`npm.cmd install`；其他系统：`npm install` |
| 开发启动 | Windows：`START.cmd` 或 `npm.cmd run dev`；其他系统：`npm run dev` |
| 生产构建 | `npm run build` |
| 生产启动 | `npm run start` |
| 默认地址 | `http://localhost:3000/`；端口占用时自动顺延 |
| 后端/API | 依赖模块内置的同源 Route Handlers |
| 数据库 | 完整协作功能依赖 Cloudflare D1，逻辑绑定名 `DB` |
| 对象存储 | 图片上传依赖 Cloudflare R2，逻辑绑定名 `UPLOADS` |
| 本地文件 | `public/data/dashboard.json` 是 API/D1 不可用时的只读兜底数据 |

Node.js 要求为 `>=22.13.0`。Python 仅用于可选的数据生成脚本，依赖见 `requirements-data.txt`。

## 接入方式建议

### 推荐：iframe 嵌入

优先使用 iframe。模块已有完整页面、同源 API、D1 状态管理和 R2 上传链路，iframe 能保持现有功能边界，接入成本最低，也避免总工作台与本模块的 React、样式和路由发生冲突。

建议总工作台为模块配置独立子域或稳定模块 URL，并将该 URL 放入 iframe。总工作台负责菜单、权限入口和模块可用性展示；模块继续负责内部任务操作。

### 可选：路由整合

若总工作台同样运行在 Cloudflare/Vite/vinext 技术栈，可把模块挂载到 `/modules/comment-monitor/`，但需要统一处理：

- API 前缀与反向代理；
- D1/R2 绑定；
- 静态资源 base path；
- 身份与写操作权限；
- iframe 改为路由后可能出现的 CSS 与布局冲突。

当前前端 API 使用根路径 `/api/...`，直接挂子路径前必须由网关重写，或后续另行做 base-path 改造。

### 暂不推荐：抽成组件整合

不建议当前阶段抽 React 组件。该模块不是纯展示组件，页面与 API、数据库、上传、乐观锁和操作日志耦合较完整。组件化会把本次“只做接入整理”扩大为架构改造，并增加回归风险。若未来统一组件库，可先抽取只读概览卡片，保留任务处理页为独立模块。

## 页面入口

- 首页 URL：`/`
- 主页面文件：`app/page.tsx`
- 前端交互入口：`app/dashboard-client.tsx`
- Worker 入口：`worker/index.ts`
- 静态兜底页面：`static/index.html`（历史静态版本，不是当前主入口）
- 当前无其他业务页面路由。

建议总工作台暴露的模块导航地址：`{MODULE_BASE_URL}/`。

## API 清单

所有地址均相对于模块域名；当前 API 默认按同源调用。

| 方法 | 地址 | 用途 | 主要输入/输出 |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | 获取工作台完整状态 | 返回元数据、`tasks`、`owners`、`operations` |
| POST | `/api/sync` | 同步当天生成的任务 | 输入含 `tasks[]` 及生成时间、数据新鲜度、范围、阈值、汇总；返回 `received/created/refreshed/held` |
| PATCH | `/api/tasks/{taskId}` | 更新负责人、步骤状态、完成状态和备注 | 输入 `actor`、可选 `version`、`changes`；返回更新后的任务；版本冲突返回 409 |
| POST | `/api/tasks/{taskId}/operations` | 记录一次操作 | `operation_type` 支持 `placement`、`dealer_guard`、`pinned_comment`、`official_reply` |
| DELETE | `/api/tasks/{taskId}/operations` | 撤回本轮最近一次指定操作 | 输入 `actor`、`operation_type` |
| POST | `/api/uploads` | 上传任务图片材料 | `multipart/form-data`：`file`、`actor`、`task_id`；单文件不超过 8MB |
| GET | `/api/uploads/{key...}` | 读取 R2 图片 | 返回对象流，私有缓存响应 |

### 需要暴露给总工作台的状态/数据

总工作台可轮询 `GET /api/dashboard` 并提取：

- `generated_at`、`task_date`：模块更新时间和任务日期；
- `data_freshness.spotlight_as_of`、`pgy_as_of`、`pgy_snapshot_as_of`：数据新鲜度；
- `summary.total/p0/p1/p2`：任务总量和优先级分布；
- `tasks[].status`、`resolution_status`、`owner`：待处理、处理中、已完成和负责人分布；
- `operations`：最近操作记录；
- API HTTP 状态：用于总工作台展示“可用/只读兜底/不可用”。

当前没有专用 `/health` API。总工作台可以 `GET /api/dashboard` 作为可用性探针；如需轻量健康检查，应在统一接入阶段另开小改造，不在本交付包内新增业务接口。

## 数据依赖

### 运行时依赖

- Cloudflare D1 `DB`：`dashboard_meta`、`maintenance_tasks`、`activity_log`、`operation_events`、`note_uploads`。
- Cloudflare R2 `UPLOADS`：任务图片材料，对象 key 形式为 `notes/{note_id}/...`。
- `public/data/dashboard.json`：D1 无数据或不可用时的只读初始化/兜底数据。

### 数据生成依赖

- 聚光 Excel：脚本按工作簿结构读取投放底表和笔记清单。
- 蒲公英快照：`work/xhs_source_snapshots/YYYYMMDD/pugongying_snapshot.csv`。
- 生成脚本：`scripts/build-maintenance-data.py`。
- 生成目标：`public/data/dashboard.json`。

### 静态资源与生成目录

- `public/`：生产静态资源及兜底数据。
- `build/sites-vite-plugin.ts`：Vite/Sites 构建插件源码；名称虽为 `build`，但不是生成目录，必须交付。
- `static/`：历史静态版本，保留用于回溯，不作为主入口。
- `dist/`：`npm run build` 生成，不纳入源代码交付。
- `.wrangler/`、`.vinext/`：本地开发状态/缓存，不纳入交付。
- `node_modules/`：安装生成，不纳入压缩包。
- R2 `notes/` 前缀：线上上传对象目录。
- `drizzle/`：数据库迁移文件，必须随源代码交付。

## 环境变量和配置项

模块没有必须由使用者填写的业务环境变量。运行依赖主要通过绑定和配置文件提供：

| 名称 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `DB` | D1 binding | 完整功能必需 | 协作任务和操作记录数据库 |
| `UPLOADS` | R2 binding | 图片功能必需 | 图片材料对象存储 |
| `.openai/hosting.json` | 配置文件 | Sites 部署必需 | 保存 `project_id` 及 `DB`/`UPLOADS` 逻辑绑定 |
| `CODEX_SANDBOX` | 环境变量 | 否 | 值为 `seatbelt` 时开发服务器使用轮询监听，仅用于特定开发环境 |
| `WRANGLER_WRITE_LOGS` | 环境变量 | 否 | Vite 配置默认设为 `false` |
| `WRANGLER_LOG_PATH` | 环境变量 | 否 | 默认 `.wrangler/logs` |
| `MINIFLARE_REGISTRY_PATH` | 环境变量 | 否 | 默认 `.wrangler/registry` |

总工作台自身建议配置 `COMMENT_MONITOR_MODULE_URL`，其值为本模块部署根地址；这不是模块内部读取的环境变量。

## 目录结构与改动边界

```text
used-car-workbench-module-comment-monitor-dashboard/
├─ app/
│  ├─ page.tsx                    # 页面入口
│  ├─ dashboard-client.tsx        # 主交互入口
│  └─ api/                        # API 路由
├─ db/
│  ├─ schema.ts                   # 数据结构源文件
│  └─ runtime.ts                  # D1 初始化与序列化
├─ drizzle/                       # 生成的迁移；不要手工改
├─ build/sites-vite-plugin.ts     # Sites 构建插件源码；必须保留
├─ public/
│  └─ data/dashboard.json         # 生成数据；不要手工改
├─ scripts/
│  └─ build-maintenance-data.py   # 数据生成入口
├─ worker/index.ts                # Cloudflare Worker 入口
├─ .openai/hosting.json           # Sites/D1/R2 配置；迁移环境时核对
├─ vite.config.ts                 # 构建与本地绑定配置
├─ package.json                   # Node 启动/构建命令
├─ package-lock.json              # 依赖锁；不要手工改
├─ START.cmd                      # Windows 启动入口
├─ VERIFY.cmd                     # Windows 验证入口
├─ RUNBOOK.md                     # 独立运行说明
└─ INTEGRATION.md                 # 本接入说明
```

入口文件：`app/page.tsx`、`app/dashboard-client.tsx`、`worker/index.ts`、`scripts/build-maintenance-data.py`。

不要直接修改：`drizzle/*.sql`、`package-lock.json`、`public/data/dashboard.json`、构建生成目录。`.openai/hosting.json` 中的 `project_id` 属于当前 Sites 项目，复制到新的托管环境前应由平台负责人确认是否复用。

## 已知限制

- 写接口当前没有模块级 RBAC；需依赖 Sites/总工作台访问策略，不应直接公开到互联网。
- API 采用根路径并默认同源，子路径路由整合需要网关重写或后续 base-path 改造。
- iframe 能否嵌入取决于最终托管层的 CSP/X-Frame-Options；当前源代码未主动阻止 iframe。
- D1 不可用时前端可读取兜底 JSON，但只能只读，保存和上传不可用。
- R2 不可用时图片上传返回 503，不影响其他任务操作。
- 数据生成脚本依赖现有聚光工作簿结构和蒲公英快照目录约定。
- `static/` 是历史版本，数据口径可能落后于 `public/data/dashboard.json`。
- 当前没有专用健康检查和模块间事件总线。

## 需要总工作台配合的事项

1. 提供模块根 URL 配置和菜单入口，首选 iframe 打开。
2. 在网关/Sites 层限制访问范围，并为写操作提供统一身份或成员白名单。
3. 若 iframe 跨域，确认 CSP `frame-ancestors`、Cookie/SameSite 和登录跳转策略。
4. 使用 `GET /api/dashboard` 汇总任务数、优先级、数据日期和处理进度。
5. 若采用路由整合，提供 `/api` 反向代理、静态资源路径和 D1/R2 绑定映射。
6. 确认是否复用 `.openai/hosting.json` 中现有 Sites `project_id`；新环境应由托管平台重新绑定资源。
7. 保持现有日常发布主流程只在 PASS 后调用 `/api/sync`，不得用旧数据触发供应商提醒。
