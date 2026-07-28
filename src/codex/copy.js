'use strict';

const fs = require('fs');
const prompts = require('../lib/prompt');
const store = require('./store');
const paths = require('../lib/paths');
const { assertValidProfileName, assertValidNewProfileName, isValidProfileName, isReservedProfileName } = require('../lib/validate');
const { maskSecret } = require('../lib/mask');
const { extractManagedToml } = require('../lib/toml');

const CURRENT_SOURCE = 'current';

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

/**
 * 读取来源配置：
 * - 'current'：读取 ~/.codex/config.toml 的受管部分 + auth.json，不触碰其他文件。
 * - 其余：按配置档名读取。
 * 返回 { toml, auth } 新对象；来源不被修改。
 */
function readSourceProfile(source) {
  if (source === CURRENT_SOURCE) {
    let raw;
    try {
      raw = fs.readFileSync(paths.codexConfigFile(), 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new Error('当前 Codex 配置不存在（~/.codex/config.toml）');
      }
      throw new Error(`无法读取当前 Codex 配置（${err.message}）`);
    }
    const toml = extractManagedToml(raw);
    if (!toml.trim()) {
      throw new Error('当前配置中没有可复制的受管内容（model/provider 设置）');
    }
    let auth = null;
    try {
      const authRaw = fs.readFileSync(paths.codexAuthFile(), 'utf8');
      auth = JSON.parse(authRaw);
      if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
        throw new Error('根值必须是对象');
      }
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        throw new Error(`当前 Codex auth.json 损坏或无法读取（${err.message}）`);
      }
    }
    return { toml, auth };
  }
  assertValidProfileName(source);
  if (!store.profileExists(source)) {
    throw new Error(`配置档不存在: ${source}`);
  }
  return { toml: store.readConfigToml(source), auth: store.readAuth(source) };
}

// 深拷贝：复制后的目标与来源完全独立，互不影响。
function deepCopyProfile({ toml, auth }) {
  return { toml: String(toml), auth: auth ? JSON.parse(JSON.stringify(auth)) : null };
}

function sourceLabel(source) {
  return source === CURRENT_SOURCE ? '当前 Codex 配置' : `配置档 ${source}`;
}

// 展示来源摘要（密钥脱敏）与目标名称，请求确认；返回是否继续。
async function confirmCopy(source, target, { toml, auth }) {
  console.log('');
  console.log(`来源: ${sourceLabel(source)}`);
  console.log(`目标: 新配置档 ${target}`);
  console.log(toml);
  const key = auth && typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';
  console.log(`  API Key: ${key ? maskSecret(key) : '(不管理密钥)'}`);
  console.log('');
  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message: '确认复制？',
    initial: true,
  }, { onCancel });
  return ok;
}

/**
 * 复制配置档主流程。
 *
 * 非交互：
 *   clis codex copy current <新名称>
 *   clis codex copy <来源名称> <新名称>
 * 无参数时进入引导流程。只传一个参数视为用法错误。
 */
async function runCopy(sourceArg, targetArg) {
  try {
    if (sourceArg && targetArg) {
      return await copyNonInteractive(sourceArg, targetArg);
    }
    if (sourceArg || targetArg) {
      throw new Error('用法: clis codex copy <来源名称|current> <新名称>');
    }
    return await copyInteractive();
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，未复制任何配置。');
      return;
    }
    throw err;
  }
}

async function copyNonInteractive(source, target) {
  assertValidNewProfileName(target);
  if (store.profileExists(target)) {
    // 非交互模式不做隐式覆盖；覆盖必须走交互的显式确认流程。
    throw new Error(`配置档已存在: ${target}（非交互模式不覆盖既有配置档）`);
  }
  const profile = readSourceProfile(source);
  store.createProfile(target, deepCopyProfile(profile));
  console.log(`已复制 ${sourceLabel(source)} → 配置档 ${target}`);
}

async function copyInteractive() {
  // 1. 选择来源
  const names = store.listProfiles();
  const hasCurrent = fs.existsSync(paths.codexConfigFile());
  if (!hasCurrent && names.length === 0) {
    console.log('没有可复制的来源（当前配置与配置档都不存在）。');
    return;
  }
  const sourceChoices = [];
  if (hasCurrent) {
    sourceChoices.push({ title: '当前 Codex 配置（~/.codex/config.toml）', value: CURRENT_SOURCE });
  }
  for (const n of names) sourceChoices.push({ title: `配置档 ${n}`, value: n });

  const { source } = await prompts({
    type: 'select',
    name: 'source',
    message: '选择复制来源',
    choices: sourceChoices,
  }, { onCancel });

  const profile = readSourceProfile(source);

  // 2. 输入新名称
  const res = await prompts({
    type: 'text',
    name: 'target',
    message: '新配置档名称',
    validate: (v) => {
      const t = (v || '').trim();
      if (!isValidProfileName(t)) return '名称只能包含字母、数字、短横线或下划线';
      if (isReservedProfileName(t)) return '该名称是保留字（copy 的来源标识），请换一个';
      return true;
    },
  }, { onCancel });
  const target = res.target.trim();

  // 3. 覆盖需显式确认
  let overwrite = false;
  if (store.profileExists(target)) {
    const ow = await prompts({
      type: 'confirm',
      name: 'ok',
      message: `配置档 ${target} 已存在，确认覆盖？`,
      initial: false,
    }, { onCancel });
    if (!ow.ok) {
      console.log('已取消，来源与目标均未被修改。');
      return;
    }
    overwrite = true;
  }

  // 4. 摘要确认后写入
  const ok = await confirmCopy(source, target, profile);
  if (!ok) {
    console.log('已取消，来源与目标均未被修改。');
    return;
  }
  store.createProfile(target, deepCopyProfile(profile), { overwrite });
  console.log(`已复制 ${sourceLabel(source)} → 配置档 ${target}`);
}

module.exports = { runCopy, readSourceProfile, deepCopyProfile };
