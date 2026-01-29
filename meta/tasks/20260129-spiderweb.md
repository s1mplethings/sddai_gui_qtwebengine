# 2026-01-29 Spiderweb Layout & AI Doc Generator

## Goal
- 加速蛛网图生成与交互；让布局更像蛛网（放射状/分层）。
- 内置 AI Doc 架构模板，可一键生成/更新到任意项目。

## DoD
- [ ] 节点≈500 时首次渲染 < 2s（否则给出 profiling 数据与瓶颈说明）。
- [ ] 默认布局呈放射/同心蛛网形；节点不重叠，边线不遮挡标签。
- [ ] 交互流畅：拖拽/缩放/点节点无明显卡顿；大图自动降级（隐藏部分标签/边）。
- [ ] 提供 AI Doc 模板生成：可选择目标目录，生成 docs/aidoc/*，已有文件自动备份。
- [ ] scripts/verify_repo.ps1 通过；附手动演示步骤。

## Plan
- web/app.js：
  - 增加同心/放射布局 fallback；大图 LOD（标签/边抽稀）。
  - 样式调整：中心/一级/二级节点样式、曲线边、透明度，减少遮挡。
  - 简单性能日志（生成/布局耗时）。
- C++/Qt：
  - SddaiBridge 增加 generateAidoc(targetPath) 从模板复制。
  - MainWindow 增加菜单动作，目录选择后调用 generateAidoc。
- Templates & scripts：
  - ai_context/templates/aidoc/* 模板文件。
  - scripts/gen_aidoc.{ps1,sh} 便于独立生成。
- Docs：更新 README/AGENTS 指向路径，描述使用步骤。

## Verify
- powershell -ExecutionPolicy Bypass -File scripts/verify_repo.ps1
- 手动：运行应用，加载示例（>300 节点）观察渲染时间；菜单 File -> Generate AI Doc..., 选择临时目录，检查 docs/aidoc 生成且原文件备份。
