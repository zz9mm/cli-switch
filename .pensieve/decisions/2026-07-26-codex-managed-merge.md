---
id: decision-codex-managed-merge
type: decision
title: Codex 配置档采用受管合并而非整文件覆盖
status: active
created: 2026-07-26
updated: 2026-07-26
tags: [clis, codex, profile, toml]
---

# Codex 配置档采用受管合并而非整文件覆盖

## 一句话结论

> Codex 配置档只保存受管 TOML 片段（模型/provider 顶层键 + `[model_providers.*]`）与 auth.json，切换时合并进 `~/.codex/config.toml`，本机状态逐字保留。

## 上下文链接

- Based on: [[knowledge/cli-profile-scope/content]]
- Related: [[decision-default-to-guided-profile-management]]

## 上下文

`~/.codex/config.toml` 混合两类内容：配置档级（`model`、`model_provider`、`model_reasoning_effort`、`model_verbosity`、`[model_providers.*]`）与本机状态（`[projects.*]` 信任记录、`[tui.*]`、`[windows]` 沙箱）。API Key 独立存于 `~/.codex/auth.json`。

## 问题

照搬 Claude 的「整文件覆盖」切换会清掉 Codex 的项目信任记录等本机状态，造成数据丢失。

## 考虑过的替代方案

- 整文件覆盖 config.toml：实现最简单，但切换即丢失 trust_level 等本机状态，不可接受。
- 引入 TOML 解析依赖做结构化合并：违反项目零依赖 maxim（prompt 模块都是手写零依赖）。

## 决策

- 受管范围白名单：4 个模型顶层键 + `[model_providers.*]` section；其余内容一律不属于配置档。
- `src/lib/toml.js` 行级切分合并（splitToml / mergeConfig），不做完整 TOML 解析，保持零依赖。
- 编辑器模式录入用 `assertValidManagedToml` 守住边界：禁止把本机状态写进配置档。
- 引导编辑只处理标准单 provider 结构（section 内字段 ⊆ name/base_url/wire_api/requires_openai_auth），否则提示改用编辑器模式，防止重建时静默丢弃高级字段。
- auth.json 独立成档：允许「不管理密钥」的配置档（走环境变量）。

## 结果

新增 CLI 适配器时先分析目标配置文件是否混合本机状态；若是，必须定义受管范围白名单并做合并，禁止整文件覆盖。切换前备份需覆盖所有会被改写的文件（codex 为 config.toml + auth.json 双备份）。

## 探索减负

- 下次可以少查什么：codex 配置档目录结构、受管键清单（见 `src/lib/toml.js` 的 MANAGED_TOP_KEYS）。
- 失效条件：Codex 改变配置结构（如密钥并入 config.toml 或本机状态迁出）。
