# 自研 HTML + map.json

## 背景
ReactFlow 与 Excalidraw 都不适合作为最终底座后，项目回到冻结的 canvas.html，建立正式 app.html。

## 当时考虑
保留单文件、轻量、可审计和画布交互控制力；把数据格式、Markdown、本地桥和 Agent 生命周期作为一等公民，而不是迁就外部画布模型。

## 结果
自研 HTML 成为正式路线：canvas.html 冻结为验收样板，app.html 持续演进；桥统一保存同步，map.json v2 记录索引，节点与方案详情写入 Markdown。

## 当前意义
这是技术路线支线唯一保留为正式产品的绿色结果，也是协议、记忆和分发工作的基础。

## 下一步
继续以 app.html + 本地桥为正式入口，维护协议兼容和人工可审阅性。

## 相关资料
canvas.html；app.html；goal.md 最终形态
