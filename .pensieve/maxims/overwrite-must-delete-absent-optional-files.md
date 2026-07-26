---
id: overwrite-must-delete-absent-optional-files
type: maxim
title: Overwrite must delete absent optional files
status: active
created: 2026-07-26
updated: 2026-07-26
tags: [pensieve, maxim, profile, overwrite]
---

# Overwrite must delete absent optional files

## One-line Conclusion
> 覆盖写一组文件时，可选文件在新内容中缺席 = 显式删除旧文件，而不是跳过写入。

## Guidance
- 「只写有、不写无」会让旧文件残留并在后续读取时静默生效（本项目中 copy 覆盖配置档后旧 auth.json 残留，旧密钥在下次切换时生效）。
- 同类变体：用「重建」方式编辑配置片段时，原片段里允许但未出现在重建模板中的字段值必须显式读出并保留（如 `requires_openai_auth` 被引导编辑静默翻回默认值）。
- CLI 保留字（如 copy 的 `current` 来源标识）必须在创建入口拒绝，不能依赖读取路径的优先级「碰巧正确」。

## Boundaries
- 覆盖语义适用于「目标内容由来源完整定义」的场景；合并语义（如 codex 受管合并）不受此约束。

## Context Links (recommended)
- Based on: [[decisions/2026-07-26-codex-managed-merge]]
- Related: [[maxims/preserve-user-visible-behavior-as-a-hard-rule]]
