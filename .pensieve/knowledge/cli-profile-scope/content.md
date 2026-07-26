---
id: knowledge-cli-profile-scope
type: knowledge
title: clis 配置档功能范围
status: active
created: 2026-07-24
updated: 2026-07-24
tags: [clis, claude-code, profile]
---

# clis 配置档功能范围

## 来源

2026-07-24 与用户确认的产品需求。

## 摘要

`clis` 首版以 Claude Code 为首个适配目标，并按“创建、切换、复制、查看或编辑、删除”五项功能组织引导式操作。

## 内容

- 工具名称为 `clis`，命令的第一个子命令用于选择受管理的 CLI，例如 `claude`，后续可扩展 `codex`。
- 直接运行 `clis` 必须进入交互式引导；带完整参数的子命令只作为自动化入口。
- 创建配置档只允许“从空白配置引导填写”和“在编辑器中编辑 JSON”两种方式。
- API URL、API Key、模型属于空白配置引导的基础字段；API Key 必须无回显输入且仅以脱敏形式展示。
- 复制当前配置或既有配置档必须通过独立的复制功能完成。

## 使用时机

设计或实现 Claude Code、Codex 等 CLI 适配器及其配置档交互时优先阅读。
