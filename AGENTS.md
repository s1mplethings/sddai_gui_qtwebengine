# SDDAI GUI (QtWebEngine) — Codex 项目契约（强约束）

> 目标：这是“实验 + 可用工具”的仓库。**任何改动必须可验证、可回退、可复现**。

## 0. Codex 运行规则（必须遵守）
1. **先读再动手**：开始任何任务前，先读取并总结本仓库的：
   - `BUILD.md`（如何构建）
   - `PATCH_README.md`（如何产出 patch / zip）
   - `TREE.md`（结构约定）
   - `ai_context/` 内的约定文档（如果存在）
2. **先找现成实现再造轮子（Research-first）**：
   - 先用网络检索 3~5 个“同类实现/库/示例项目”，记录到 `meta/externals/<topic>.md`（模板见 `meta/externals/TEMPLATE.md`）。
   - 对每个候选写：许可证、维护活跃度、体量、集成方式、你为什么选它/弃它。
   - 研究完后，把选型结论和 DoD 摘要同步到 `meta/tasks/<YYYYMMDD>-<topic>.md`，方便复用。
3. **只交付可应用的变更**：
   - 默认交付为 `git apply` 可用的 unified diff（或放到 `PATCHES/` 里）。
   - 如果要交付 zip，zip 必须包含：patch + 新增文件 + 应用说明（见本仓库的 `PATCH_README.md`）。
4. **强制验收（Verify gate）**：
   - 任何改动完成后必须运行 `scripts/verify_repo.*`（如不存在则按本仓库约定补齐）并在输出中给出关键结果/失败原因。
   - 验收失败要写明下一步（修复思路/绕过方式），不允许“我觉得可以”式提交。
5. **最小改动原则**：
   - 每个 patch 只解决一个主题；避免同时大改结构 + 大改逻辑。
   - 新依赖必须写入 `third_party/THIRD_PARTY.md` 并说明引入原因、版本、license。

## 1. 目录责任边界（你必须按边界做事）
- `src/`：Qt/C++ 主程序、WebEngine 宿主、文件索引/解析、与 JS 的桥接（QWebChannel / IPC）。
- `web/`：纯前端（Markdown 渲染、Graph 可视化、交互）。
- `ai_context/`：给 AI 的项目规则、工作流、问题记忆、外部参考清单。
- `meta/`：任务单、外部方案评审、实验记录。
- `scripts/`：一键构建/校验/打包脚本（verify、pack、生成清单等）。

## 2. 你在这个项目里最常见的正确做法（建议默认）
- **QtWebEngine + 本地 HTML/JS**：C++ 只负责提供数据（文件树/链接关系/搜索结果），JS 负责渲染（Markdown/Graph）。
- **Graph 优先用 d3-force / canvas**：DOM/SVG 节点太多会卡；优先 Canvas/WebGL 路线。
- **渲染要可降级**：大图时自动降级：减少 label、聚类、限制最大节点、惰性加载。

## 3. 必须产出的“工程痕迹”
- 任务开始：`meta/tasks/<YYYYMMDD>-<topic>.md`（模板：`meta/tasks/TEMPLATE.md`）
- 选型：`meta/externals/<topic>.md`
- 改动：一个 patch（或一组 patch）
- 验收：`scripts/verify_repo.*` 输出

