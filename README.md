# SDDAI GUI Workspace

本仓库聚合 Qt WebEngine 客户端与 Codex 工作流约束。按下列顺序使用：

## 快速开始
1. 阅读 `AGENTS.md`，明确强约束与交付格式。
2. 查看 `BUILD.md`、`PATCH_README.md`、`TREE.md` 了解结构与构建方式。
3. 构建（Windows 示例）：
   ```powershell
   ./build_v6.cmd
   ```
4. 验收（必须）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/verify_repo.ps1
   ```
   或在类 Unix 环境运行：
   ```bash
   bash scripts/verify_repo.sh
   ```

## 工作流（与 AGENTS 一致）
- DoD 先行：在 `meta/tasks/<YYYYMMDD>-<topic>.md` 写清验收项。
- Research 优先：候选方案写入 `meta/externals/<topic>.md`（模板已内置）。
- Patch 交付：优先提供可 `git apply` 的 diff，新增依赖记入 `third_party/THIRD_PARTY.md`。
- 验收闭环：每次改动后运行 verify 脚本并记录结果/失败原因。

## 新增工具
- **蛛网布局 & LOD**：前端提供同心/放射布局 fallback，大图自动抽稀标签；控制台打印 `renderGraph.total` 便于性能观察。
- **AI Doc 生成**：
  - UI：运行应用，菜单 File -> `Generate AI Doc...` 选择目标目录，生成 `docs/aidoc/*`（已有文件备份为 .bak）。
  - 脚本：
    ```powershell
    powershell -ExecutionPolicy Bypass -File scripts/gen_aidoc.ps1 -Target "C:\\path\\to\\project"
    ```
    ```bash
    bash scripts/gen_aidoc.sh /path/to/project
    ```

## 目录速览
- `src/` `include/` `web/`：Qt 主程序与前端静态资源。
- `meta/`：任务单与外部方案调研记录。
- `ai_context/`：AI 执行上下文与模板。
- `scripts/`：验证与生成脚本。
- `.codex/`：Codex 客户端配置。

## 反馈
发现指令/流程不清晰时，先在 `meta/tasks/` 记录，再提交针对文档的补丁。
