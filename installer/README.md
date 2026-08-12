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

首次点击“安装并开始使用”时，程序只写入 `%LocalAppData%\LiveDotMap\current`，不会请求管理员权限；随后让用户选择项目文件夹，并调用已有 SEA 的 `install` 创建该项目的 `.live-dot-map/` 和已发现 Agent 的配置。地图始终留在项目内。

安装后仍可在同一个图形窗口完成维护：

- “修复 / 更新”先把新 payload 复制到临时目录并重新校验，再切换安装目录；切换失败会恢复旧版本。
- “卸载（保留地图）”会恢复安装器自己写入的 Agent 配置，删除程序和开始菜单入口，但保留项目内的 `.live-dot-map/`、Markdown、历史与备份。
- 如果开始菜单入口创建失败，窗口仍会提示并保留“打开安装位置”作为降级入口。

这是未签名的内部 RC 候选，不是 Microsoft Store MSIX，也不应作为面向陌生公众的下载入口。干净机人工验收、签名、Store/Release 发布仍属于公开分发门禁。
