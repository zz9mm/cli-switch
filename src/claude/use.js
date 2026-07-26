'use strict';

const prompts = require('../lib/prompt');
const profiles = require('../lib/profiles');
const state = require('../lib/state');
const paths = require('../lib/paths');
const { ensureDir, atomicWriteFile } = require('../lib/fsutil');
const { backupClaudeSettings } = require('../lib/backup');
const { assertValidProfileName } = require('../lib/validate');
const { maskSettingsForDisplay } = require('../lib/mask');

class CancelError extends Error {
  constructor() {
    super('已取消');
    this.name = 'CancelError';
    this.cancelled = true;
  }
}
function onCancel() {
  throw new CancelError();
}

// 列表项标题：名称 + 模型 + 主机 + 最近使用时间；绝不包含密钥。
function choiceTitle(name) {
  let detail = '';
  try {
    const s = profiles.summarize(profiles.readSettings(name));
    const meta = profiles.readMeta(name);
    const parts = [];
    if (s.model) parts.push(s.model);
    if (s.host) parts.push(s.host);
    if (meta.lastUsedAt) parts.push(`上次使用 ${meta.lastUsedAt}`);
    if (parts.length) detail = ` — ${parts.join(' @ ').replace(' @ 上次', '，上次')}`;
  } catch {
    detail = ' — (配置无法解析)';
  }
  const current = state.readCurrentProfile() === name ? '（当前）' : '';
  return `${name}${current}${detail}`;
}

/**
 * 应用配置档为当前生效配置（核心流程，供交互与非交互共用）。
 *
 * 顺序：校验配置档 JSON → 备份现有配置 → 原子写入 → 更新元数据与状态。
 * 写入失败时 atomicWriteFile 保证不留下截断文件，原有配置保持可用。
 *
 * @returns {{ settings: object, backupPath: string|null }}
 */
function applyProfile(name) {
  assertValidProfileName(name);
  if (!profiles.profileExists(name)) {
    throw new Error(`配置档不存在: ${name}`);
  }

  let settings;
  try {
    settings = profiles.readSettings(name);
  } catch (err) {
    throw new Error(`配置档 JSON 损坏，已中止切换: ${name}（${err.message}）`);
  }

  const backupPath = backupClaudeSettings();

  ensureDir(paths.claudeHome(), 0o700);
  atomicWriteFile(paths.claudeSettingsFile(), JSON.stringify(settings, null, 2) + '\n', 0o600);

  profiles.touchLastUsed(name);
  state.setCurrentProfile(name);
  return { settings, backupPath };
}

function printApplied(name, backupPath) {
  console.log(`已切换为配置档: ${name}`);
  if (backupPath) {
    console.log(`旧配置已备份: ${backupPath}`);
  } else {
    console.log('（此前没有生效配置，无需备份）');
  }
}

// 展示将要应用的配置摘要（脱敏）。
function printPreview(name, settings) {
  console.log('');
  console.log(`将应用配置档: ${name}`);
  console.log(JSON.stringify(maskSettingsForDisplay(settings), null, 2));
  console.log('');
}

/**
 * 切换配置档主流程。
 * @param {string|undefined} presetName 非交互入口传入的名称。
 */
async function runUse(presetName) {
  try {
    // —— 非交互：clis claude use <名称> ——
    if (presetName) {
      assertValidProfileName(presetName);
      if (!profiles.profileExists(presetName)) {
        throw new Error(`配置档不存在: ${presetName}`);
      }
      const settings = tryRead(presetName);
      if (!settings) {
        throw new Error(`配置档 JSON 损坏，已中止切换: ${presetName}`);
      }
      printPreview(presetName, settings);
      const { backupPath } = applyProfile(presetName);
      printApplied(presetName, backupPath);
      return;
    }

    // —— 交互：列表选择 → 摘要 → 确认 → 应用 ——
    const names = profiles.listProfiles();
    if (names.length === 0) {
      console.log('没有可切换的配置档，请先创建。');
      return;
    }

    const { name } = await prompts({
      type: 'select',
      name: 'name',
      message: '选择要切换的配置档',
      choices: names.map((n) => ({ title: choiceTitle(n), value: n })),
    }, { onCancel });

    const settings = tryRead(name);
    if (!settings) {
      throw new Error(`配置档 JSON 损坏，已中止切换: ${name}`);
    }
    printPreview(name, settings);

    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: '确认应用为当前配置？（现有配置会先备份）',
      initial: true,
    }, { onCancel });
    if (!ok) {
      console.log('已取消，未切换配置档。');
      return;
    }

    const { backupPath } = applyProfile(name);
    printApplied(name, backupPath);
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，未切换配置档。');
      return;
    }
    throw err;
  }
}

function tryRead(name) {
  try {
    return profiles.readSettings(name);
  } catch {
    return null;
  }
}

/**
 * clis claude current：显示当前由 clis 应用的配置档。
 */
function runCurrent() {
  const s = state.readState();
  if (!s.currentProfile) {
    console.log('当前没有由 clis 应用的配置档。');
    return;
  }
  console.log(`当前配置档: ${s.currentProfile}`);
  console.log(`应用时间: ${s.appliedAt || '(未知)'}`);
  if (!profiles.profileExists(s.currentProfile)) {
    console.log('警告：该配置档已不存在，状态记录可能已过期。');
  }
}

module.exports = { runUse, runCurrent, applyProfile, CancelError };
