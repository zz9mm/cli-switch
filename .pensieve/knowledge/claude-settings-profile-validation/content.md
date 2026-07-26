---
id: knowledge-claude-settings-profile-validation
type: knowledge
title: Claude Settings Profile Validation
status: active
created: 2026-07-24
updated: 2026-07-24
tags: [clis, claude-code, settings, validation]
---

# Claude Settings Profile Validation

## Source

- `src/claude/create.js`
- `src/lib/profiles.js`
- 2026-07-24 本地排障：`/tmp/clis-test/claude/profiles/kimi/settings.json`

## Summary

Claude Code 只读取实际配置目录中的合法 JSON；profile 存储文件需要先通过 JSON 校验，再以合并或应用方式写入全局设置。

## Content

- `clis` profile 的默认保存位置是 `<configHome>/claude/profiles/<name>/settings.json`，该目录不是 Claude Code 的自动发现目录。
- Claude Code 用户级配置文件是 `~/.claude/settings.json`；它必须是合法 JSON。
- 配置中的相邻属性需要逗号分隔。少一个逗号会导致整个文件无法解析，Claude Code 无法加载其中的 `env`。
- 直接用只含 `env` 的 profile 覆盖既有 `~/.claude/settings.json`，会移除原文件中的 hooks、插件、状态栏和其他用户设置。注意：本项目已确认采用整份覆盖 + 备份语义（见 [[decisions/2026-07-25-switch-overwrites-claude-settings-with-backup]]），排查"切换后 hooks 消失"类问题时应先从 `backups/` 恢复，而非视为 bug。
- `createProfile` 通过 `JSON.stringify` 后再 `JSON.parse` 写入，正常创建路径不会产生语法无效的 JSON；遇到无效文件时，应排查创建后的手工编辑或外部写入。

## When to Use

排查 Claude Code 切换 API profile 后无法启动、认证或模型调用失败时，先验证 profile 与实际生效 `settings.json` 的 JSON 语法和写入路径。

## Context Links

- Related: [[decisions/2026-07-24-default-to-guided-profile-management]]
