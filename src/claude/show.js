'use strict';

const fs = require('fs');
const prompts = require('../lib/prompt');
const profiles = require('../lib/profiles');
const paths = require('../lib/paths');
const { assertValidProfileName, isValidApiUrl } = require('../lib/validate');
const { maskSecret, maskSettingsForDisplay } = require('../lib/mask');
const { editInEditor } = require('../lib/editor');

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
 * 汇总配置档用于展示的信息：元数据 + 摘要 + 脱敏密钥。
 * API Key 始终只以脱敏形式出现。
 */
function profileSummary(name) {
  assertValidProfileName(name);
  const meta = profiles.readMeta(name);
  let settings = null;
  let broken = null;
  try {
    settings = profiles.readSettings(name);
  } catch (err) {
    broken = err.message;
  }
  const env = (settings && settings.env) || {};
  const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
  const s = settings ? profiles.summarize(settings) : { baseUrl: '', host: '', model: '' };
  return {
    name,
    baseUrl: s.baseUrl,
    host: s.host,
    model: s.model,
    maskedKey: key ? maskSecret(key) : '(未设置)',
    createdAt: meta.createdAt || null,
    updatedAt: meta.updatedAt || null,
    lastUsedAt: meta.lastUsedAt || null,
    broken,
  };
}

function printSummary(name) {
  const s = profileSummary(name);
  console.log('');
  console.log(`配置档: ${s.name}`);
  if (s.broken) {
    console.log(`  配置 JSON 损坏: ${s.broken}`);
  } else {
    console.log(`  API URL: ${s.baseUrl || '(未设置)'}`);
    console.log(`  模型: ${s.model || '(未设置)'}`);
    console.log(`  API Key: ${s.maskedKey}`);
  }
  console.log(`  创建时间: ${s.createdAt || '(未知)'}`);
  console.log(`  最近使用: ${s.lastUsedAt || '(从未使用)'}`);
  console.log('');
}

// 交互选择配置档；无配置档时返回 null。
async function pickProfile(message) {
  const names = profiles.listProfiles();
  if (names.length === 0) {
    console.log('没有配置档。');
    return null;
  }
  const { name } = await prompts({
    type: 'select',
    name: 'name',
    message,
    choices: names.map((n) => ({ title: n, value: n })),
  }, { onCancel });
  return name;
}

/**
 * clis claude show [名称]：查看配置档摘要（密钥脱敏）。
 * 无名称时进入引导：选择配置档 → 摘要 → 选择后续操作。
 */
async function runShow(presetName) {
  try {
    if (presetName) {
      assertValidProfileName(presetName);
      if (!profiles.profileExists(presetName)) {
        throw new Error(`配置档不存在: ${presetName}`);
      }
      printSummary(presetName);
      return;
    }

    const name = await pickProfile('选择要查看的配置档');
    if (!name) return;
    printSummary(name);

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: '选择后续操作',
      choices: [
        { title: '返回', value: 'back' },
        { title: '引导更新 API URL / API Key / 模型', value: 'guided' },
        { title: '在编辑器中编辑 JSON', value: 'editor' },
      ],
    }, { onCancel });
    if (action === 'guided' || action === 'editor') {
      await runEditFlow(name, action);
    }
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消。');
      return;
    }
    throw err;
  }
}

/**
 * clis claude edit [名称]：编辑配置档。
 * 无名称时先选择配置档，再选择编辑方式。
 */
async function runEdit(presetName) {
  try {
    let name = presetName;
    if (name) {
      assertValidProfileName(name);
      if (!profiles.profileExists(name)) {
        throw new Error(`配置档不存在: ${name}`);
      }
    } else {
      name = await pickProfile('选择要编辑的配置档');
      if (!name) return;
    }

    const { method } = await prompts({
      type: 'select',
      name: 'method',
      message: '选择编辑方式',
      choices: [
        { title: '引导更新 API URL / API Key / 模型', value: 'guided' },
        { title: '在编辑器中编辑 JSON（高级字段）', value: 'editor' },
      ],
    }, { onCancel });
    await runEditFlow(name, method);
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，配置档未修改。');
      return;
    }
    throw err;
  }
}

async function runEditFlow(name, method) {
  if (method === 'editor') return editViaEditor(name);
  return editViaGuided(name);
}

/**
 * 编辑器模式：临时文件编辑整份 JSON。
 * 只有确认且 JSON 校验通过时才原子覆盖原配置档；
 * 取消、编辑器异常退出或 JSON 无效时原文件保持不变。
 */
async function editViaEditor(name) {
  const original = fs.readFileSync(paths.profileSettingsFile(name), 'utf8');
  const edited = editInEditor(original, { suffix: '.json' });

  let parsed;
  try {
    parsed = JSON.parse(edited);
    profiles.assertValidSettings(parsed);
  } catch (err) {
    console.log(`JSON 校验失败（${err.message}），配置档未修改。`);
    return;
  }

  const ok = await confirmSave(name, parsed);
  if (!ok) return;
  profiles.createProfile(name, parsed, { overwrite: true });
  console.log(`已更新配置档: ${name}`);
}

/**
 * 引导模式：逐项更新 API URL、API Key、模型。留空表示保持原值。
 * API Key 无回显输入；其余字段回显当前值供参考。
 */
async function editViaGuided(name) {
  const settings = profiles.readSettings(name);
  const env = settings.env && typeof settings.env === 'object' ? settings.env : {};
  const curUrl = env.ANTHROPIC_BASE_URL || '';
  const curModel = env.ANTHROPIC_MODEL || '';
  // 沿用原有的密钥字段名；两者都没有时按创建流程默认写 AUTH_TOKEN。
  const keyField = typeof env.ANTHROPIC_AUTH_TOKEN === 'string'
    ? 'ANTHROPIC_AUTH_TOKEN'
    : (typeof env.ANTHROPIC_API_KEY === 'string' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN');

  const urlRes = await prompts({
    type: 'text',
    name: 'baseUrl',
    message: `API URL（当前: ${curUrl || '(未设置)'}，留空保持不变）`,
    validate: (v) => {
      const t = (v || '').trim();
      if (!t) return true;
      return isValidApiUrl(t) ? true : '请输入有效的 http:// 或 https:// 地址';
    },
  }, { onCancel });

  const keyRes = await prompts({
    type: 'password',
    name: 'apiKey',
    message: `API Key（当前: ${env[keyField] ? maskSecret(env[keyField]) : '(未设置)'}，留空保持不变，输入不回显）`,
  }, { onCancel });

  const modelRes = await prompts({
    type: 'text',
    name: 'model',
    message: `模型（当前: ${curModel || '(未设置)'}，留空保持不变）`,
  }, { onCancel });

  const next = JSON.parse(JSON.stringify(settings));
  next.env = Object.assign({}, env);
  const newUrl = (urlRes.baseUrl || '').trim();
  const newKey = keyRes.apiKey || '';
  const newModel = (modelRes.model || '').trim();
  if (newUrl) next.env.ANTHROPIC_BASE_URL = newUrl;
  if (newKey) next.env[keyField] = newKey;
  if (newModel) next.env.ANTHROPIC_MODEL = newModel;

  if (!newUrl && !newKey && !newModel) {
    console.log('未做任何修改。');
    return;
  }

  const ok = await confirmSave(name, next);
  if (!ok) return;
  profiles.createProfile(name, next, { overwrite: true });
  console.log(`已更新配置档: ${name}`);
}

// 展示脱敏预览并请求确认；拒绝时打印未修改提示。
async function confirmSave(name, settings) {
  console.log('');
  console.log(`将更新配置档: ${name}`);
  console.log(JSON.stringify(maskSettingsForDisplay(settings), null, 2));
  console.log('');
  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message: '确认保存？',
    initial: true,
  }, { onCancel });
  if (!ok) {
    console.log('已取消，配置档未修改。');
    return false;
  }
  return true;
}

module.exports = { runShow, runEdit, profileSummary };
