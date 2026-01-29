# AI Doc Scaffold

> 用途：生成目标项目的 AI 辅助文档骨架，便于 Codex/LLM 快速理解工程。

## 结构
- docs/aidoc/README.md            # 顶层说明与约定
- docs/aidoc/context.md           # 域背景 / 业务上下文
- docs/aidoc/architecture.md      # 系统/模块架构草图
- docs/aidoc/flows.md             # 关键流程（序列图/状态机）
- docs/aidoc/prompts.md           # 常用 prompt 模板
- docs/aidoc/decisions.md         # 重要决策记录 (ADR 风格)
- docs/aidoc/checklists.md        # 发布/回归/安全清单

## 使用方式
1) 运行生成脚本（或在 UI 中点“Generate AI Doc”）：
   - PowerShell: `scripts\gen_aidoc.ps1 -Target "C:\\path\\to\\project"`
   - bash: `scripts/gen_aidoc.sh /path/to/project`
2) 进入目标项目填写内容；文件可反复覆盖生成，脚本会备份已有文件到 *.bak。
3) 在 Codex 对话里引用这些文件路径，提升上下文质量。
