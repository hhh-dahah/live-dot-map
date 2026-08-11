# AGENTS.md — 活点地图
> 本文件只做项目路由；按任务读取对应文档，不在这里记录阶段历史。

## 先读什么
- 方向、阶段与边界：`goal.md`
- 产品定义与功能规则：`产品需求文档-PRD.md`
- 执行历史与验证方法：`implement.md`
- 界面与品牌：`UI设计需求文档.md`、`brand-spec.md`
- 走查问题与当前计划：`设计细节.md`、`docs/真实用户实测记录.md`、`docs/plans/`
- 数据与 Agent 协议：`docs/map-json-v1.md`、`docs/agent-protocol.md`

## 项目边界
- `canvas.html` 是冻结的验收样板；正式产品在 `app.html` 演进。
- `landing/` 是落地页源代码（Next.js 静态导出）；`landing.html` 仅保留为旧版参考，不再作为发布入口。
- 发布 landing 时在 `landing/` 执行 `npm run build:deploy`，只更新 `.deploy/` 的静态导出文件；不得覆盖其中的 `app.html`、`agent-kit/` 与 PWA 文件。
- 界面文案、代码注释和文档使用简体中文。
- 颜色使用 `:root` 的 OKLch 令牌并同步 `brand-spec.md`；绿、红、灰只表达方案状态。
- 数据读写遵守 `docs/map-json-v1.md`；协议改动同步 `docs/agent-protocol.md` 与 `agent-kit/`。
- Excalidraw fork 仅作参考；复制其代码须保留 MIT 版权与许可。

## 工作约定
- 修改前读相关文档；完成后把重大方向更新到 `goal.md`，执行与验证追加到 `implement.md`。
