# 供应商评论维护工作台

这是“二手车投放综合工作台”的可接入模块交付包。模块用于把聚光投放数据与蒲公英评论数据整理成每日供应商评论维护任务，并支持多人认领、处理状态、操作记录、富文本备注和图片上传。

完整接入说明见 [INTEGRATION.md](./INTEGRATION.md)，独立运行步骤见 [RUNBOOK.md](./RUNBOOK.md)。

## 最快启动

Windows：双击 `START.cmd`，或在命令行运行：

```bat
START.cmd
```

跨平台命令：

```bash
npm install
npm run dev
```

默认访问地址：<http://localhost:3000/>。若端口被占用，开发服务器会自动使用下一个可用端口并在终端显示实际地址。

## 交付范围

- `app/`：页面和 API 入口
- `db/`、`drizzle/`：D1 数据结构与迁移
- `build/sites-vite-plugin.ts`：Sites 构建插件源码（必须保留）
- `worker/`：Cloudflare Worker 入口
- `public/data/dashboard.json`：无数据库时的只读兜底数据
- `scripts/`：任务数据生成脚本
- `.openai/hosting.json`：Sites 的 D1/R2 逻辑绑定配置

不要直接修改 `drizzle/*.sql`、`package-lock.json`、`public/data/dashboard.json`。修改数据结构应从 `db/schema.ts` 生成迁移；更新任务数据应运行生成脚本。
