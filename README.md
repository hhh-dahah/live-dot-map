# 活点地图

活点地图是一张适合开放式任务探索的人机协作地图：人提供业务上下文，Agent 在同一份项目记忆上继续探索、记录方案并返回可审核的大节点。

## 当前形态

- `app.html`：正式画布；`canvas.html`：冻结样板。
- 本地桥负责可靠保存、WAL 恢复、冲突检测、SSE 同步、确定性图检索和 MCP。
- `agent-kit/` 提供 Codex、Claude Code、Kimi Code 的项目适配器；平台信任仍由用户确认。
- 双击 `app.html` 是降级模式，会明确显示未启用 Agent 自动读取和并发保护。

## 开发验证

```powershell
npm ci
npm run verify
```

`verify` 会依次运行核心测试、三浏览器强模式、降级模式、性能、三适配器模拟闭环、安装器降级入口和部署产物检查。生产部署、真实客户端信任和 Microsoft Store 提交不由本地脚本代替。

## 接入

普通用户应使用安装器或图形化入口选择项目文件夹；开发者可阅读 [`agent-kit/setup.md`](agent-kit/setup.md)。地图数据默认留在项目目录的 `.live-dot-map/`，不会上传项目内容。
