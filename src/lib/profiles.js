'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { ensureDir, atomicWriteFile } = require('./fsutil');
const { assertValidProfileName, isValidProfileName } = require('./validate');

/**
 * 配置档持久层。
 *
 * 目录布局：
 *   <configHome>/claude/profiles/<name>/settings.json  (0600) Claude Code 可读
 *   <configHome>/claude/profiles/<name>/meta.json       (0600) clis 元数据
 *
 * 所有目录 0700，所有文件 0600。
 */

function profileExists(name) {
  assertValidProfileName(name);
  try {
    return fs.statSync(paths.profileSettingsFile(name)).isFile();
  } catch {
    return false;
  }
}

function listProfiles() {
  const dir = paths.claudeProfilesDir();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // 遍历时先过滤非法名称（校验函数只守入口，不当过滤器用）：
  // 手放的备份目录、编辑器临时目录等不应让整个列表崩溃。
  return entries
    .filter((e) => e.isDirectory() && isValidProfileName(e.name))
    .map((e) => e.name)
    .filter((name) => profileExists(name))
    .sort();
}

function readSettings(name) {
  assertValidProfileName(name);
  const raw = fs.readFileSync(paths.profileSettingsFile(name), 'utf8');
  return assertValidSettings(JSON.parse(raw));
}

function assertValidSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Claude settings 必须是 JSON 对象');
  }
  return settings;
}

function readMeta(name) {
  assertValidProfileName(name);
  try {
    return JSON.parse(fs.readFileSync(paths.profileMetaFile(name), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 创建新配置档。若同名已存在且未显式 overwrite，则抛错。
 * settings 会先做 JSON 序列化校验，再原子写入。
 */
function createProfile(name, settings, { overwrite = false } = {}) {
  assertValidProfileName(name);
  if (!overwrite && profileExists(name)) {
    throw new Error(`配置档已存在: ${name}`);
  }
  assertValidSettings(settings);
  // 序列化校验：确保可被 JSON 表达。
  const settingsJson = JSON.stringify(settings, null, 2);
  JSON.parse(settingsJson);

  const now = new Date().toISOString();
  const existingMeta = overwrite ? readMeta(name) : {};
  const meta = {
    name,
    createdAt: existingMeta.createdAt || now,
    updatedAt: now,
    lastUsedAt: existingMeta.lastUsedAt || null,
  };

  ensureDir(paths.claudeProfilesDir(), 0o700);
  ensureDir(paths.profileDir(name), 0o700);
  atomicWriteFile(paths.profileSettingsFile(name), settingsJson + '\n', 0o600);
  atomicWriteFile(paths.profileMetaFile(name), JSON.stringify(meta, null, 2) + '\n', 0o600);
  return meta;
}

/**
 * 记录配置档最近使用时间（切换生效后调用）。
 * 其余元数据字段原样保留。
 */
function touchLastUsed(name, when) {
  assertValidProfileName(name);
  if (!profileExists(name)) {
    throw new Error(`配置档不存在: ${name}`);
  }
  const meta = readMeta(name);
  meta.name = name;
  meta.lastUsedAt = when || new Date().toISOString();
  atomicWriteFile(paths.profileMetaFile(name), JSON.stringify(meta, null, 2) + '\n', 0o600);
  return meta;
}

/**
 * 从 settings 中提取用于摘要展示的字段（不含密钥明文）。
 */
function summarize(settings) {
  const env = (settings && settings.env) || {};
  const url = env.ANTHROPIC_BASE_URL || '';
  let host = '';
  try {
    host = url ? new URL(url).host : '';
  } catch {
    host = '';
  }
  return {
    baseUrl: url,
    host,
    model: env.ANTHROPIC_MODEL || '',
    hasApiKey: typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.length > 0,
  };
}

/**
 * 删除配置档目录。
 *
 * 双重安全：名称经 assertValidProfileName 校验（无斜杠/点，天然防穿越），
 * 再确认解析后的目录严格位于 profiles 根目录之下才删除。
 */
function deleteProfile(name) {
  assertValidProfileName(name);
  if (!profileExists(name)) {
    throw new Error(`配置档不存在: ${name}`);
  }
  const resolved = path.resolve(paths.profileDir(name));
  const resolvedRoot = path.resolve(paths.claudeProfilesDir());
  if (path.dirname(resolved) !== resolvedRoot) {
    throw new Error('拒绝删除：目标路径超出配置档目录');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

module.exports = {
  profileExists,
  listProfiles,
  readSettings,
  readMeta,
  createProfile,
  deleteProfile,
  touchLastUsed,
  summarize,
  assertValidSettings,
};
