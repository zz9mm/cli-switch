---
id: decision-switch-overwrites-claude-settings-with-backup
type: decision
title: 切换配置档整份覆盖 ~/.claude/settings.json 并以备份兜底
status: active
created: 2026-07-25
updated: 2026-07-25
tags: [clis, claude-code, settings, switch]
---

# 切换配置档整份覆盖 ~/.claude/settings.json 并以备份兜底

## 一句话结论

> `clis claude use` 目前将配置档内容整份原子覆盖到 `~/.claude/settings.json`，切换前把旧文件备份到 `backups/settings-<时间戳>.json` 作为唯一恢复手段。

## 上下文链接

- Tension with: [[knowledge/claude-settings-profile-validation/content]]
- Based on: [[decisions/2026-07-24-default-to-guided-profile-management]]

## 上下文

实现计划 02（切换配置档）时，计划文本要求"备份当前 settings.json 后原子写入目标配置"，未明确要求保留原文件中不属于配置档的字段。

## 问题

整份覆盖会丢弃用户在 `~/.claude/settings.json` 中已有的 hooks、statusLine、插件配置等非 env 字段——既有知识 `claude-settings-profile-validation` 曾明确记录过这个坑。

## 考虑过的替代方案

- **合并写入（只替换 env 相关键，保留其余字段）**：符合既有知识，但语义复杂——配置档删除某个键时无法表达"移除"，且 env 与非 env 边界需要约定。
- **整份覆盖 + 备份（当前实现）**：语义最简单、行为可预测（生效配置 == 配置档），备份保证可回滚；代价是用户的 hooks 等设置被移除，需手工从备份恢复。

## 决策

按计划文本实现整份覆盖 + 备份，**用户已于 2026-07-25 确认**保持该语义：生效配置 == 配置档，行为可预测；hooks/statusLine 等被移除时从备份恢复。既有知识 `claude-settings-profile-validation` 中的合并写入建议在本项目明确不采纳。

## 结果

当前行为：切换后 `~/.claude/settings.json` 与配置档完全一致；旧文件在 `~/.config/clis/claude/backups/` 按时间戳保留。

## 探索减负

- 下次可以少问什么：切换的写入语义与备份位置已定。
- 下次可以少查什么：applyProfile 的顺序（校验 → 备份 → 原子写 → state/lastUsedAt）。
- 失效条件：用户确认需要保留 settings.json 中的非配置档字段，则改为合并写入并更新本条。
