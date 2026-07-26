'use strict';

const fs = require('fs');
const prompts = require('../lib/prompt');
const profiles = require('../lib/profiles');
const paths = require('../lib/paths');
const { assertValidProfileName, assertValidNewProfileName, isValidProfileName, isReservedProfileName } = require('../lib/validate');
const { maskSettingsForDisplay } = require('../lib/mask');

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
 * - 'current'：仅读取 ~/.claude/settings.json，不触碰认证凭据文件。
 * - 其余：按配置档名读取。
 * 返回深拷贝对象；JSON 损坏时抛错，来源不被修改。
 */
function readSourceSettings(source) {
  if (source === CURRENT_SOURCE) {
    let raw;
    try {
      raw = fs.readFileSync(paths.claudeSettingsFile(), 'utf8');
    } catch {
      throw new Error('当前 Claude Code 配置不存在（~/.claude/settings.json）');
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`当前配置 JSON 损坏，已中止复制: ${err.message}`);
    }
  }
  assertValidProfileName(source);
  if (!profiles.profileExists(source)) {
    throw new Error(`配置档不存在: ${source}`);
  }
  try {
    return profiles.readSettings(source);
  } catch (err) {
    throw new Error(`配置档 JSON 损坏，已中止复制: ${source}（${err.message}）`);
  }
}

// 深拷贝：复制后的目标与来源完全独立，互不影响。
function deepCopy(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function sourceLabel(source) {
  return source === CURRENT_SOURCE ? '当前 Claude Code 配置' : `配置档 ${source}`;
}

// 展示来源摘要（脱敏）与目标名称，请求确认；返回是否继续。
async function confirmCopy(source, target, settings) {
  console.log('');
  console.log(`来源: ${sourceLabel(source)}`);
  console.log(`目标: 新配置档 ${target}`);
  console.log(JSON.stringify(maskSettingsForDisplay(settings), null, 2));
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
 *   clis claude copy current <新名称>
 *   clis claude copy <来源名称> <新名称>
 * 无参数时进入引导流程。只传一个参数视为用法错误。
 */
async function runCopy(sourceArg, targetArg) {
  try {
    if (sourceArg && targetArg) {
      return await copyNonInteractive(sourceArg, targetArg);
    }
    if (sourceArg || targetArg) {
      throw new Error('用法: clis claude copy <来源名称|current> <新名称>');
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
  if (profiles.profileExists(target)) {
    // 非交互模式不做隐式覆盖；覆盖必须走交互的显式确认流程。
    throw new Error(`配置档已存在: ${target}（非交互模式不覆盖既有配置档）`);
  }
  const settings = readSourceSettings(source);
  profiles.createProfile(target, deepCopy(settings));
  console.log(`已复制 ${sourceLabel(source)} → 配置档 ${target}`);
}

async function copyInteractive() {
  // 1. 选择来源
  const names = profiles.listProfiles();
  const hasCurrent = fs.existsSync(paths.claudeSettingsFile());
  if (!hasCurrent && names.length === 0) {
    console.log('没有可复制的来源（当前配置与配置档都不存在）。');
    return;
  }
  const sourceChoices = [];
  if (hasCurrent) {
    sourceChoices.push({ title: '当前 Claude Code 配置（~/.claude/settings.json）', value: CURRENT_SOURCE });
  }
  for (const n of names) sourceChoices.push({ title: `配置档 ${n}`, value: n });

  const { source } = await prompts({
    type: 'select',
    name: 'source',
    message: '选择复制来源',
    choices: sourceChoices,
  }, { onCancel });

  const settings = readSourceSettings(source);

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
  if (profiles.profileExists(target)) {
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
  const ok = await confirmCopy(source, target, settings);
  if (!ok) {
    console.log('已取消，来源与目标均未被修改。');
    return;
  }
  profiles.createProfile(target, deepCopy(settings), { overwrite });
  console.log(`已复制 ${sourceLabel(source)} → 配置档 ${target}`);
}

module.exports = { runCopy, readSourceSettings, deepCopy };
