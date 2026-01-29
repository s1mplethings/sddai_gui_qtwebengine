# 选型/找现成实现（Research-first）检查表

每次要加新功能，都要在 `meta/externals/<topic>.md` 写完这些再动手：

- 目标：我到底要什么？（一句话）
- 约束：必须本地运行？是否允许外网？是否可打包到资源？
- 候选 A/B/C：
  - 链接（repo / 文档）
  - 许可证（MIT/BSD/GPL/…）
  - 维护情况（最近 commit / release）
  - 集成方式（npm vendoring / submodule / 拷贝）
  - 体量（依赖多不多）
  - 风险（性能/安全/平台）
- 结论：选哪个，为什么（明确到“哪一份代码/哪一个目录/哪一个 API”）

