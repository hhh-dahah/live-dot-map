# agent-kit — 一分钟把活点地图接入你的项目

给使用 AI 编程助手（Codex / Kimi Code / Claude Code 等）的人。接入后，你的 Agent 每次会话开始会主动汇报项目全局：当前进展、等你判断的方案、停滞的路线。

## 接入（二选一）

**让 Agent 全自动接（推荐）**：在项目目录里对你的 Agent 说一句——

> 运行 curl -sL https://livedotmap.top/agent-kit/setup.md 查看接入指引，按它在我的项目目录完成活点地图接入；如果拉取失败，把网址换成 https://app.live-dot-map.workers.dev/agent-kit/setup.md 再试，仍失败换 https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com/agent-kit/setup.md。

Agent 会按 `setup.md` 自动完成：下载画布到 `~/.live-dot-map/`、建桌面快捷方式、注入协议、初始化地图、拉起画布。

**手动接**：

1. 画布：下载 `app.html` 放到 `~/.live-dot-map/`（Windows 即 `C:\Users\<用户>\.live-dot-map\`），双击即开。
2. 协议：打开本目录的 `AGENTS.snippet.md`，把全部内容追加到你项目根目录 `AGENTS.md` 的末尾（没有 AGENTS.md 就新建一个）。
3. 地图：在项目根新建 `.live-dot-map/` 目录，把 `map.template.json` 复制进去改名 `map.json`。不复制也行——下次会话对 Agent 说「初始化活点地图」，它会读你的现有记录生成草稿。

## 之后

- 打开活点地图画布（网页版或本地 `~/.live-dot-map/app.html`），连上项目文件夹，就能在画布上看到 Agent 维护的地图。
- 每次会话 Agent 会先输出地图摘要：主路线推进到哪、哪些方案等你判断、哪条路线停滞了。
- 判断权永远在你：评分你打、归档你确认、画布上随便改，Agent 下次读到的就是你的版本。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `setup.md` | Agent 全自动接入指引（上面口令引用的就是这份，含多源下载兜底） |
| `AGENTS.snippet.md` | 协议段，贴入项目 AGENTS.md（由 `docs/agent-protocol.md` 生成，两处内容一致） |
| `map.template.json` | 空白地图模板：一条主路线 + 一个「开始」节点，放进项目 `.live-dot-map/` 改名 `map.json` |
| `index.html` | 本说明页的图文版（`index (2).html` 导航页也链到这里） |
