---
id: knowledge-claude-code-model-tier-env
type: knowledge
title: Claude Code 模型档位 env 解析
status: active
created: 2026-07-26
updated: 2026-07-26
tags: [clis, claude-code, settings, env, model]
---

# Claude Code 模型档位 env 解析

## Source

- 2026-07-26 用户粘贴的 Kimi 中转配置（全档位映射到 k3 系）
- `src/claude/create.js`（`MODEL_TIERS`、`buildSettings` 的 `tierModels`）

## Summary

Claude Code 的模型配置是两层结构：一个总默认模型 + 各档位（Opus/Sonnet/Haiku/Fable）的可选覆盖；配置档只需一个模型字段的假设是错误的。

## Content

- `ANTHROPIC_MODEL`：总默认模型；未单独配置的档位回落到它。
- `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_FABLE_MODEL`：按档位覆盖默认模型。中转端常见用法是把所有档位指向同一模型（或 1M 上下文变体，如 `k3[1M]`）。
- 每个档位还有对应的 `ANTHROPIC_DEFAULT_<TIER>_MODEL_NAME`（显示名）变体；另有 `ANTHROPIC_REASONING_MODEL` 指定推理模型。
- 相关上下文窗口配置：`CLAUDE_CODE_AUTO_COMPACT_WINDOW`、`CLAUDE_CODE_MAX_CONTEXT_TOKENS`（如 `262144`）。
- `clis` 引导模式支持档位映射：选完主模型后可选为各档位单独映射（`buildSettings({ tierModels })` 只写入非空档位）；缺省时各档位沿用主模型。

## When to Use

创建 / 编辑配置档涉及模型字段时，或排查"切换配置档后某档位模型不对"类问题（如子代理、fast mode 走了非预期模型）时，先检查这些 env 的组合而非只看 `ANTHROPIC_MODEL`。

## Context Links

- Related: [[knowledge/claude-settings-profile-validation/content]]
- Related: [[decisions/2026-07-24-default-to-guided-profile-management]]
