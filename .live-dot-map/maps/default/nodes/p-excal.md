# Excalidraw 复刻后否决

## 背景
阶段 2 曾在 Excalidraw fork 上复刻 canvas.html 的画布功能，完成 T1–T22 并修复 W1–W14。

## 当时考虑
复用成熟画布的工具栏、选择、箭头、绑定和渲染能力，先验证交互对齐，数据暂用示例。

## 结果
复刻和走查基本完成，TypeScript 0 错误；2026-08-06 用户否决 fork 路线，master 和 wip-stage2 存档，仅作参考。

## 失败原因
产品底层要做 map.json、Markdown、人类标注、Agent 身份、可靠写入和检索；Excalidraw 数据模型与架构改造成本超过组件复用收益。

## 当前意义
正式产品不再基于 Excalidraw fork，只吸收交互经验。

## 相关资料
docs/plans/2026-08-06-阶段2-excalidraw复刻.md；docs/plans/2026-08-06-阶段3-协议层与HTML正式化.md
