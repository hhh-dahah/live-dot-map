# 活点地图 — 设计规范（brand-spec）

> 来源：PRD v2.0、UI 设计需求文档、两张 Excalidraw 风格参考截图。
> 气质：安静、克制、清楚、轻量、可信赖。

## 色彩（OKLch）

```css
:root {
  --bg:            oklch(100% 0 0);        /* 画布纯白 */
  --surface:       oklch(98.6% 0.004 286); /* 浮层/面板:极淡紫灰 */
  --surface-hover: oklch(96% 0.008 286);
  --fg:            oklch(27% 0.015 285);   /* 主文字/图标:深灰,非纯黑 */
  --muted:         oklch(55% 0.02 285);    /* 次要文字:中灰 */
  --border:        oklch(91% 0.008 285);   /* 发丝边框 */
  --accent:        oklch(54% 0.16 286);    /* 选中/激活:Excalidraw 紫蓝 ≈ #6965DB */
  --accent-soft:   oklch(91% 0.035 288);   /* 激活态背景 ≈ #E0DFFF */
  --ink:           oklch(24% 0.01 285);    /* 发送/确认按钮:近黑 */

  /* 方案状态三色 — 仅用于方案线/状态徽标,不作他用 */
  --success:       oklch(58% 0.15 145);    /* 成功绿 ≈ #2F9E44 */
  --danger:        oklch(56% 0.19 27);     /* 失败红 ≈ #E03131 */
  --pending:       oklch(68% 0.012 285);   /* 待验证灰 */

  /* 便签黄 — 仅用于标注背景(人与 Agent 统一),不作他用 */
  --note:          oklch(96% 0.09 90);     /* 便签黄底 */
  --note-border:   oklch(88% 0.1 85);      /* 便签发丝边框 */
  --note-shadow:   0 1px 3px rgba(27,27,31,.12);
}
```

规则：
- 绿 = 方案成功，红虚线 = 方案失败，灰 = 待验证/不可用。红色实心徽标/浅红底仅用于“问题节点”，两者必须同时依靠线型、形状和文字区分；除此之外的交互（选中、Agent 提交、工具激活）一律用紫蓝或近黑。
- 不使用渐变、大面积强调色背景。
- 便签黄（--note）仅用于标注背景（人与 Agent 统一），不挪用至其它元素。
- 普通节点不使用红绿灰状态色；`kind:problem` 节点可使用红色边框、浅红底和“问题”徽标表达语义，不表示方案失败。

## Landing 补充令牌

落地页按 `docs/真实用户实测记录.md` 对标 plus.excalidraw.com。2026-08-10 阶段 8 实测修正：plus.excalidraw.com 实际为白底（此前淡绿 `#F9FFF9` 系误采样），现行为微暖白底 + 深蓝墨 + Excalidraw 紫蓝唯一强调色；这些颜色不承载方案状态语义。

```css
:root {
  --landing-bg: #FDFDFB;          /* 微暖白,非纯白 */
  --landing-ink: #030064;         /* 标题/正文深蓝墨(对标实测) */
  --landing-accent: #6965DB;      /* Excalidraw 紫蓝,与画布 --accent 同族:主按钮/高亮/勾选 */
  --landing-accent-deep: #5753C8; /* 主按钮 hover */
  --landing-accent-soft: #E0DFFF; /* 标题高亮块/浅紫底 */
  --landing-star: #FFE599;        /* GitHub 星标钮黄 */
  --landing-star-border: #705400;
  --landing-dark: #171642;        /* 页脚深藏青 */
}
```

- `--landing-star` 仅用于 GitHub 星标 CTA，hover 时回退为白底。
- 全页唯一强调色是紫蓝；黄色只属于星标钮；landing 不出现绿/红（产品截图内的状态色除外）。
- 圆角规则：按钮 8px；媒体/卡片 18–20px；小徽标全圆角。
- 字体：拉丁用 Outfit（next/font 自托管），手写小注用 Caveat（仅拉丁），中文走 PingFang/雅黑回退栈。
- 上述令牌只作用于 `landing/`，画布仍遵循本文件的 OKLch 主令牌和状态色预算。

## 字体

```css
--font-body:    'Söhne', 'Avenir Next', -apple-system, BlinkMacSystemFont,
                'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
--font-display: 同上(同族,靠字重拉开层级,500/600/700);
--font-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; /* 仅编号/ID */
```

字级：面板正文 13px，画布标注 12–13px，节点名称 12.5px，属性面板字段标签 11px 大写感（中文字重 500）。

## 布局姿态（取自 Excalidraw 参考图）

1. 画布即窗口：不设全宽固定顶栏；核心工具条悬浮于顶部中央，缩放/撤销在左下角，项目入口在左上角。
2. 浮层控件统一：8px 圆角、1px `--border` 发丝边框、`0 1px 5px rgba(27,27,31,.12)` 轻投影、36px 高图标按钮、激活态铺 `--accent-soft` 底。
3. 属性面板按需从右侧滑入，未选中对象时完全隐藏；查看态不套表单框，点击进入行内编辑。
4. 节点一律圆形、不显示编号，短名称写在圆内、圆随文字自适应；方案名称附着在线上；标注一句话，用黄色小便签包裹，归属由便签角落的小尾巴（小角角）表明，拖动时尾巴随距离拉伸。
5. 悬浮反馈：节点与方案线 hover 时紫色发光（--accent-soft 光晕）；选中用紫蓝实线框/光晕。
6. 状态颜色预算：一屏内除方案线外不出现红绿；紫蓝同屏至多两处（选中对象 + 激活工具）。

## 文案基调

短句、直接动作名：新建节点 / 新建地图 / 地图已更新。
禁止：副标题、功能解释、情绪化反馈、可见的 CLI/MCP/skill/JSON 术语（只在设置里出现）。
