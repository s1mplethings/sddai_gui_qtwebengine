# 参考实现清单（优先抄这些“已验证能跑”的思路）

> 用法：当你要实现某个子功能（Markdown 渲染 / Graph / QtWebEngine 通信 / 性能优化），先看这些项目怎么做。

## Qt + Markdown 渲染（WebEngine）
- KDE/kmarkdownwebview：用 QtWebEngine + 本地网页 + JS 库渲染 Markdown，并通过桥接把纯文本喂给 JS。
- Qt 官方 WebEngine Markdown Editor 示例（很多第三方项目都提到它）。

## QtWebEngine + D3 可视化
- YimingYAN/qvisualisation：QtWebEngine 里跑 d3.js，C++ 控制 JS，适合参考“数据从 C++ 到 JS”的交互方式。

## Obsidian Graph 思路（行为）
- Obsidian Graph view：节点/边、hover 高亮、点击打开、局部图/全局图。
- obsidian-3d-graph（社区插件）：TypeScript + D3，能参考交互和性能降级策略。

## Force Layout 内核
- d3/d3-force：force simulation（布局 + 碰撞 + 连接力）是你要的“蛛网图核心”。

## Qt 原生 Markdown（备选）
- Qt-Markdown-Render：基于 QTextMarkdownImporter 重新实现渲染（如果你不想用 WebEngine 时可参考）。

