# agent-kit — 一分钟把活点地图接入你的项目

给使用 AI 编程助手（Codex / Kimi Code / Claude Code 等）的人。接入后，你的 Agent 每次会话开始会主动汇报项目全局：当前进展、等你判断的方案、停滞的路线。

## 接入（二选一）

**让 Agent 自己接（推荐）**：在项目目录里对你的 Agent 说一句——

> 把 agent-kit/AGENTS.snippet.md 的内容追加到我的 AGENTS.md 末尾，以后按里面的活点地图协议工作。

**手动接**：

1. 打开本目录的 `AGENTS.snippet.md`，把全部内容追加到你项目根目录 `AGENTS.md` 的末尾（没有 AGENTS.md 就新建一个）。
2. 可选：把 `map.template.json` 复制为项目根目录的 `map.json`。不复制也行——下次会话对 Agent 说「初始化活点地图」，它会读你的现有记录生成草稿。

## 之后

- 打开活点地图画布（网页版或本地 `app.html`），连上项目文件夹，就能在画布上看到 Agent 维护的地图。
- 每次会话 Agent 会先输出地图摘要：主路线推进到哪、哪些方案等你判断、哪条路线停滞了。
- 判断权永远在你：评分你打、归档你确认、画布上随便改，Agent 下次读到的就是你的版本。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `AGENTS.snippet.md` | 协议段，贴入项目 AGENTS.md（由 `docs/agent-protocol.md` 生成，两处内容一致） |
| `map.template.json` | 空白地图模板：一条主路线 + 一个「开始」节点 |
