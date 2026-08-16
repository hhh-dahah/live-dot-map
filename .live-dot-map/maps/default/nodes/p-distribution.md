# Windows RC 与安装器

## 背景
产品要让普通用户不安装 Node、不打开终端，也能选择项目、启动画布、连接本地桥并安全更新。

## 当时考虑
采用 .NET 8 自包含 WinForms 安装器 + Windows x64 Node SEA 桥；逐文件 SHA-256 校验、asInvoker、不请求管理员权限，并保留备份、修复、更新、回滚和卸载路径。

## 结果
内部 Windows RC、项目启动器、安装/更新/修复/卸载链路和隔离自动验证已完成；payload 与 manifest 可校验，运行中的桥占用也有定向处理。

## 当前意义
安装和分发基础已具备，但仍是内部 RC，不代表签名、Store/Release 和公开下载门禁完成。

## 下一步
完成新安装包人工复测、干净机验证、线上发布源一致性、签名和公开渠道验收。

## 相关资料
installer/README.md；docs/plans/8-12上线plan.md；implement.md Windows 安装器记录
