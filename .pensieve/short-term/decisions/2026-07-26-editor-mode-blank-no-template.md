---
id: decision-editor-mode-blank-no-template
type: decision
title: 编辑器模式打开空白文件，不预填任何模板
status: active
created: 2026-07-26
updated: 2026-07-26
tags: [clis, claude-code, create, editor]
---

# 编辑器模式打开空白文件，不预填任何模板

## 一句话结论

> `clis claude create` 的编辑器模式打开**空白文件**，由用户自行编写完整 JSON；不预填模板（无论是示例配置还是本机完整配置）。

## 上下文链接

- Based on: [[decisions/2026-07-25-switch-overwrites-claude-settings-with-backup]]
- Related: [[knowledge/claude-settings-profile-validation/content]]

## 上下文

编辑器模式最初硬编码了一份 moonshot 示例模板。2026-07-26 我基于"整份覆盖会冲掉 hooks/插件/状态栏"的考虑（见上方 decision），主动把模板替换为用户本机完整配置（含 hooks、enabledPlugins、statusLine）。同一轮对话中用户明确指示："将模板去掉，不需要模板"，模板文件被删除，编辑器回到空白起步。

## 问题

模板的存在本身被用户否定——即使模板能解决"覆盖冲掉 hooks"的副作用，用户仍偏好空白起步、自己写全。

## 考虑过的替代方案

- **本机完整配置作模板**：能避免覆盖冲掉 hooks，但用户明确否决（2026-07-26）。
- **moonshot 示例模板**：早期版本，随本次改动一并移除，用户同样未要求恢复。
- **空白文件（当前实现）**：最简洁；保存为空时报"配置内容为空"，JSON 无效拒绝写入。

## 决策

编辑器模式不预填任何内容。不要在未来迭代中主动把模板加回来；若用户需要现成配置，入口是 `clis claude copy current` 或手工编写。

## 结果

`src/claude/create.js` 的 `editorInput()` 以空串调用 `editInEditor`；`default-template.json` 已删除。副作用提醒保留在 README 与会话沟通中：只含 env 的配置档切换时会冲掉 hooks 等字段（整份覆盖语义），从 `backups/` 恢复。

## 探索减负

- 下次可以少问什么：编辑器模式是否需要模板——不需要，用户已否决两次（示例模板与完整配置模板）。
- 下次可以少查什么：editorInput 的输入来源（空白，无模板文件）。
- 失效条件：用户主动要求恢复模板或提供起始内容。
