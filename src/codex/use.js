'use strict';

const fs = require('fs');
const prompts = require('../lib/prompt');
const store = require('./store');
const paths = require('../lib/paths');
const { codexState } = require('../lib/state');
const { ensureDir, atomicWriteFile } = require('../lib/fsutil');
const { backupCodexConfig } = require('../lib/backup');
const { assertValidProfileName } = require('../lib/validate');
const { mergeConfig, assertValidManagedToml, summarizeToml } = require('../lib/toml');
const { maskSecret } = require('../lib/mask');

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
    const s = summarizeToml(store.readConfigToml(name));
    const meta = store.readMeta(name);
    const parts = [];
    if (s.model) parts.push(s.model);
    if (s.baseUrl) parts.push(new URL(s.baseUrl).host);
    if (meta.lastUsedAt) parts.push(`上次使用 ${meta.lastUsedAt}`);
    if (parts.length) detail = ` — ${parts.join(' @ ')}`;
  } catch {
    detail = ' — (配置无法解析)';
  }
  const current = codexState.readCurrentProfile() === name ? '（当前）' : '';
  return `${name}${current}${detail}`;
}

/**
 * 应用配置档为当前生效配置（核心流程，供交互与非交互共用）。
 *
 * 顺序：校验配置档 → 备份现有 config.toml 与 auth.json →
 * 受管合并写入 config.toml（保留 [projects.*] 等本机状态）→
 * 写入 auth.json（若配置档管理密钥）→ 更新元数据与状态。
 *
 * @returns {{ backup: { configPath: string|null, authPath: string|null } }}
 */
function applyProfile(name) {
  assertValidProfileName(name);
  if (!store.profileExists(name)) {
    throw new Error(`配置档不存在: ${name}`);
  }

  const toml = store.readConfigToml(name);
  assertValidManagedToml(toml); // 配置档被手工改坏时中止切换
  const auth = store.readAuth(name); // 凭据也必须在修改生效文件前完成校验

  const existingConfig = readOptionalFile(paths.codexConfigFile(), '当前 Codex config.toml');
  const existingAuth = readOptionalFile(paths.codexAuthFile(), '当前 Codex auth.json');

  const backup = backupCodexConfig();

  ensureDir(paths.codexHome(), 0o700);
  try {
    atomicWriteFile(paths.codexConfigFile(), mergeConfig(existingConfig || '', toml), 0o600);
    if (auth) {
      atomicWriteFile(paths.codexAuthFile(), JSON.stringify(auth, null, 2) + '\n', 0o600);
    }
  } catch (err) {
    rollbackAppliedFiles(existingConfig, auth ? existingAuth : undefined, backup, err);
  }

  if (!auth && existingAuth !== null) {
    // 配置档不管理密钥：旧 key 仍留在 auth.json 并优先生效，必须让用户知情。
    console.log('警告：该配置档不管理密钥，现有 ~/.codex/auth.json 仍保留旧密钥，将优先于环境变量生效。');
    console.log('      如需走环境变量，请先从备份中恢复或删除该文件。');
  }

  store.touchLastUsed(name);
  codexState.setCurrentProfile(name);
  return { backup };
}

function readOptionalFile(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new Error(`无法读取${label}（${err.message}）`);
  }
}

function restoreFile(filePath, previous) {
  if (previous === null) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return;
  }
  atomicWriteFile(filePath, previous, 0o600);
}

function rollbackAppliedFiles(existingConfig, existingAuth, backup, originalError) {
  const failures = [];
  try { restoreFile(paths.codexConfigFile(), existingConfig); } catch (err) { failures.push(err.message); }
  if (existingAuth !== undefined) {
    try { restoreFile(paths.codexAuthFile(), existingAuth); } catch (err) { failures.push(err.message); }
  }
  if (failures.length) {
    const backupHint = [backup.configPath, backup.authPath].filter(Boolean).join('、');
    throw new Error(`切换失败且自动恢复不完整: ${originalError.message}；恢复错误: ${failures.join('；')}；备份: ${backupHint}`);
  }
  throw new Error(`切换失败，已恢复原配置: ${originalError.message}`);
}

function printApplied(name, backup) {
  console.log(`已切换为配置档: ${name}`);
  if (backup.configPath || backup.authPath) {
    if (backup.configPath) console.log(`旧 config.toml 已备份: ${backup.configPath}`);
    if (backup.authPath) console.log(`旧 auth.json 已备份: ${backup.authPath}`);
  } else {
    console.log('（此前没有生效配置，无需备份）');
  }
}

// 展示将要应用的配置摘要（密钥脱敏）。
function printPreview(name) {
  const s = summarizeToml(store.readConfigToml(name));
  const auth = store.readAuth(name);
  const key = auth && typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';
  console.log('');
  console.log(`将应用配置档: ${name}`);
  console.log(`  模型: ${s.model || '(未设置)'}`);
  console.log(`  Provider: ${s.provider || '(未设置)'}`);
  console.log(`  API URL: ${s.baseUrl || '(未设置)'}`);
  console.log(`  API Key: ${key ? maskSecret(key) : '(不管理密钥)'}`);
  console.log('');
}

/**
 * 切换配置档主流程。
 * @param {string|undefined} presetName 非交互入口传入的名称。
 */
async function runUse(presetName) {
  try {
    // —— 非交互：clis codex use <名称> ——
    if (presetName) {
      assertValidProfileName(presetName);
      if (!store.profileExists(presetName)) {
        throw new Error(`配置档不存在: ${presetName}`);
      }
      printPreview(presetName);
      const { backup } = applyProfile(presetName);
      printApplied(presetName, backup);
      return;
    }

    // —— 交互：列表选择 → 摘要 → 确认 → 应用 ——
    const names = store.listProfiles();
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

    printPreview(name);

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

    const { backup } = applyProfile(name);
    printApplied(name, backup);
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，未切换配置档。');
      return;
    }
    throw err;
  }
}

/**
 * clis codex current：显示当前由 clis 应用的配置档。
 */
function runCurrent() {
  const s = codexState.readState();
  if (!s.currentProfile) {
    console.log('当前没有由 clis 应用的配置档。');
    return;
  }
  console.log(`当前配置档: ${s.currentProfile}`);
  console.log(`应用时间: ${s.appliedAt || '(未知)'}`);
  if (!store.profileExists(s.currentProfile)) {
    console.log('警告：该配置档已不存在，状态记录可能已过期。');
  }
}

module.exports = { runUse, runCurrent, applyProfile, CancelError };
