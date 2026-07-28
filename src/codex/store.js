'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const { ensureDir, atomicWriteFile } = require('../lib/fsutil');
const { assertValidProfileName, isValidProfileName } = require('../lib/validate');
const { assertValidManagedToml } = require('../lib/toml');

/**
 * Codex 配置档持久层。
 *
 * 目录布局：
 *   <configHome>/codex/profiles/<name>/config.toml  (0600) 受管 TOML 片段
 *   <configHome>/codex/profiles/<name>/auth.json    (0600) OPENAI_API_KEY（可选）
 *   <configHome>/codex/profiles/<name>/meta.json    (0600) clis 元数据
 *
 * config.toml 只保存 clis 受管的部分（模型/provider 顶层键与
 * [model_providers.*] section），切换时合并进 ~/.codex/config.toml，
 * 本机状态（[projects.*] 等）不属于配置档。
 */

function profileExists(name) {
  assertValidProfileName(name);
  try {
    return fs.statSync(paths.codexProfileConfigFile(name)).isFile();
  } catch {
    return false;
  }
}

function listProfiles() {
  const dir = paths.codexProfilesDir();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // 遍历时先过滤非法名称：手放的备份目录等不应让整个列表崩溃。
  return entries
    .filter((e) => e.isDirectory() && isValidProfileName(e.name))
    .map((e) => e.name)
    .filter((name) => profileExists(name))
    .sort();
}

// 读取配置档的受管 TOML 片段文本；文件缺失/不可读时抛错。
function readConfigToml(name) {
  assertValidProfileName(name);
  return fs.readFileSync(paths.codexProfileConfigFile(name), 'utf8');
}

// 读取配置档的 auth.json；没有时返回 null（该配置档不管理密钥）。
function readAuth(name) {
  assertValidProfileName(name);
  let raw;
  try {
    raw = fs.readFileSync(paths.codexProfileAuthFile(name), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new Error(`无法读取配置档 auth.json: ${name}（${err.message}）`);
  }
  try {
    const auth = JSON.parse(raw);
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      throw new Error('根值必须是对象');
    }
    return auth;
  } catch (err) {
    throw new Error(`配置档 auth.json 损坏: ${name}（${err.message}）`);
  }
}

function readMeta(name) {
  assertValidProfileName(name);
  try {
    return JSON.parse(fs.readFileSync(paths.codexProfileMetaFile(name), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 创建新配置档。若同名已存在且未显式 overwrite，则抛错。
 * @param {string} toml 受管 TOML 片段文本（存储边界会统一校验）。
 * @param {object|null} auth auth.json 内容（{ OPENAI_API_KEY }），null 表示不管理密钥。
 */
function createProfile(name, { toml, auth = null }, { overwrite = false } = {}) {
  assertValidProfileName(name);
  if (!overwrite && profileExists(name)) {
    throw new Error(`配置档已存在: ${name}`);
  }
  assertValidManagedToml(toml);
  if (auth && (typeof auth !== 'object' || Array.isArray(auth))) {
    throw new Error('Codex auth 必须是 JSON 对象或 null');
  }

  const now = new Date().toISOString();
  const existingMeta = overwrite ? readMeta(name) : {};
  const meta = {
    name,
    createdAt: existingMeta.createdAt || now,
    updatedAt: now,
    lastUsedAt: existingMeta.lastUsedAt || null,
  };

  ensureDir(paths.codexProfilesDir(), 0o700);
  ensureDir(paths.codexProfileDir(name), 0o700);
  atomicWriteFile(paths.codexProfileConfigFile(name), toml, 0o600);
  if (auth) {
    atomicWriteFile(paths.codexProfileAuthFile(name), JSON.stringify(auth, null, 2) + '\n', 0o600);
  } else {
    // 覆盖为「不管理密钥」时清除残留的旧 auth.json，防止旧密钥在下次切换时静默生效。
    try {
      fs.unlinkSync(paths.codexProfileAuthFile(name));
    } catch {
      // 文件本就不存在，无需处理。
    }
  }
  atomicWriteFile(paths.codexProfileMetaFile(name), JSON.stringify(meta, null, 2) + '\n', 0o600);
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
  atomicWriteFile(paths.codexProfileMetaFile(name), JSON.stringify(meta, null, 2) + '\n', 0o600);
  return meta;
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
  const resolved = path.resolve(paths.codexProfileDir(name));
  const resolvedRoot = path.resolve(paths.codexProfilesDir());
  if (path.dirname(resolved) !== resolvedRoot) {
    throw new Error('拒绝删除：目标路径超出配置档目录');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

module.exports = {
  profileExists,
  listProfiles,
  readConfigToml,
  readAuth,
  readMeta,
  createProfile,
  touchLastUsed,
  deleteProfile,
};
