# Issue Memory - Error Set

当 `scripts/self_check.py` 失败时，会自动生成并持久化“错误集（error_set）”，用于：

- 快速定位：失败点 → 症状 → 最接近的简单修复方法
- 给 `scripts/self_improve.py` 提供反思上下文（避免重复踩坑）

## 生成位置
- 本轮：`runs/self_check/<timestamp>/error_set.json` / `error_set.md`
- 历史：`issue_memory/errors/index.jsonl`
- 最近：`issue_memory/errors/latest.json` / `latest.md`
