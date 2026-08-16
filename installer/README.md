# Windows 图形化安装器候选

`winforms/` 是内部 RC 的 Windows x64 图形化安装器候选：它把已有的 Node SEA 本地桥与画布作为离线 payload，发布为自包含的 .NET WinForms 程序。最终用户不需要安装 Node、打开终端或提供管理员权限。

## 构建

```powershell
npm run build:windows-installer
npm run verify:windows-installer
```

产物位于 `dist/windows-installer/`：

- `LiveDotMapSetup.exe`：自包含的 WinForms 图形入口；双击运行。
- `payload/`：经 `payload-manifest.json` 逐文件 SHA-256 校验的 SEA、画布和 PWA 静态资产。
- `installer-manifest.json`：整套 RC 安装器 bundle 的文件清单和 hash。

首次点击“安装并打开画布”时，用户先查看并选择软件安装位置。程序只写入所选位置的 `current` 目录，不会请求管理员权限，也不会选择项目、创建地图或修改 Agent 配置。安装完成后打开“活点地图”产品入口；用户在产品入口选择项目后，产品按需启动本地协作会话并打开带会话的正式画布。

安装后仍可在同一个图形窗口完成维护：

- “安装并打开画布”遇到旧版、缺文件或中断残留时会自动把新 payload 复制到临时目录并重新校验，再切换安装目录；若 `current` 内的本产品桥仍在运行，会先安全停止该进程。若仍被 ACL 或其他程序保护，会保留原目录和项目数据，并提示关闭产品后重试或另选安装位置，不要求用户删除 `current`。
- “修复 / 更新”执行相同的安全替换，并保留旧版本备份以便恢复。
- “卸载（保留地图）”只删除程序、桌面和开始菜单入口，不接触任何项目目录，因此项目内的 `.live-dot-map/`、Markdown、历史与备份始终保留。
- 安装成功后创建名为“活点地图”的桌面和开始菜单入口；入口只打开产品入口，由产品按需启动协作会话，不把 `livedot-bridge` 作为用户可见产品名称或独立入口。
- 如果开始菜单入口创建失败，窗口仍会提示并保留“打开安装位置”作为降级入口。

这是未签名的内部 RC 候选，不是 Microsoft Store MSIX，也不应作为面向陌生公众的下载入口。干净机人工验收、签名、Store/Release 发布仍属于公开分发门禁。
