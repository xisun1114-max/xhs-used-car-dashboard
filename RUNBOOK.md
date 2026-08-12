# 可运行说明

## 环境要求

- Node.js 22.13.0 或更高版本
- npm（随 Node.js 安装）
- 可选：Python 3.10+，仅在本地重新生成任务 JSON 时使用

## Windows 启动

```bat
START.cmd
```

脚本会执行 `npm.cmd install`，然后启动开发服务。默认地址为 <http://localhost:3000/>；若端口被占用，以终端显示的 Local URL 为准。

如果只想验证交付包：

```bat
VERIFY.cmd
```

## 跨平台启动

```bash
npm install
npm run dev
```

生产构建与启动：

```bash
npm run build
npm run start
```

## 数据生成（可选）

模块已携带 `public/data/dashboard.json`，不生成数据也能打开只读兜底页面。若要从聚光工作簿和蒲公英快照重新生成：

```bash
python -m pip install -r requirements-data.txt
python scripts/build-maintenance-data.py --source-root "C:\path\to\source-root" --output public/data/dashboard.json --run-date 2026-08-11
```

`source-root` 需要包含聚光 Excel 工作簿，以及 `work/xhs_source_snapshots/YYYYMMDD/pugongying_snapshot.csv` 历史快照。

## 常见问题

- PowerShell 报“禁止运行 npm.ps1”：使用 `npm.cmd`，或直接运行本包的 `START.cmd`。
- 页面显示只读预览：D1 绑定未连接或 API 初始化失败；兜底 JSON 仍可读取，但协作保存不可用。
- 图片上传返回 503：R2 的 `UPLOADS` 绑定未连接。
