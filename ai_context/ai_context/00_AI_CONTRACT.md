# AI 工作流契约（你希望 Codex “完全按思路来”的关键）

> 这份文件的作用：把“你脑子里的强约束”变成仓库里可执行的规则。

## 你给 AI 的指令为什么会“不听话”
常见原因：
- 指令不在 Codex 会自动加载的文件里（例如缺少 `AGENTS.md` 或没把文件名加进 `project_doc_fallback_filenames`）。
- 指令没有“验收闸门”（没有必须通过的 verify 命令，AI 就会只做代码不跑）。
- 指令缺少“落地的输出格式”（你想要 patch/zip，但没写死：必须交付 patch 并能 apply）。
- 指令缺少“范围边界”（C++/前端/脚本职责不清，AI 会乱改一堆）。

## 你要的强约束（可直接复制到任务里）
- Research-first：先列 3~5 个现成项目/库、写对比、再决定选哪个。
- Patch-first：只交付可应用 patch；每个 patch 只做一个主题。
- Verify gate：必须跑 `scripts/verify_repo.*`，失败必须修到通过或解释为什么无法通过。
- One-file-per-purpose：规则写 `AGENTS.md`，选型写 `meta/externals`，任务写 `meta/tasks`，不要把所有东西塞到 README。

## 建议的“执行顺序”
1) 创建任务单（meta/tasks）
2) 做选型对比（meta/externals）
3) 实现（patch）
4) 验证（verify）
5) 回写：更新 spec / 任务单里的结果

