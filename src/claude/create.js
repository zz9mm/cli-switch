'use strict';

const prompts = require('../lib/prompt');
const profiles = require('../lib/profiles');
const { assertValidNewProfileName, isValidProfileName, isReservedProfileName, assertValidApiUrl } = require('../lib/validate');
const { maskSettingsForDisplay } = require('../lib/mask');
const { editInEditor } = require('../lib/editor');
const { fetchModels } = require('../lib/models');

const CUSTOM_MODEL = '__custom__';

function onCancel() {
  throw new CancelError();
}

class CancelError extends Error {
  constructor() {
    super('已取消');
    this.name = 'CancelError';
    this.cancelled = true;
  }
}

/**
 * 将引导输入转换为 Claude Code 的 settings 结构。
 *
 * @param {'api_key'|'bearer'} authType 鉴权方式：
 *   - api_key：写入 ANTHROPIC_API_KEY（x-api-key 头，官方 Anthropic）。
 *   - bearer：写入 ANTHROPIC_AUTH_TOKEN（Authorization: Bearer，第三方如 Kimi）。
 * @param {Object} [tierModels] 可选的档位映射，如
 *   { ANTHROPIC_DEFAULT_OPUS_MODEL: 'k3' }；缺省或空值时不写入。
 */
function buildSettings({ baseUrl, apiKey, model, authType = 'api_key', tierModels }) {
  const env = { ANTHROPIC_BASE_URL: baseUrl };
  if (authType === 'bearer') env.ANTHROPIC_AUTH_TOKEN = apiKey;
  else env.ANTHROPIC_API_KEY = apiKey;
  if (model) env.ANTHROPIC_MODEL = model;
  if (tierModels) {
    for (const [key, value] of Object.entries(tierModels)) {
      if (value) env[key] = value;
    }
  }
  return { env };
}

/**
 * 交互式引导填写：URL、隐藏输入 Key、动态拉取并选择模型，可选为各档位单独映射模型。
 *
 * 当前仅支持中转（Auth Token / Bearer）方式，固定写入 ANTHROPIC_AUTH_TOKEN。
 * 官方 x-api-key 方式暂不提供选择（buildSettings 仍保留 authType 以便将来恢复）。
 */
async function guidedInput() {
  const authType = 'bearer';

  const { baseUrl: rawUrl } = await prompts({
    type: 'text',
    name: 'baseUrl',
    message: 'API URL',
    validate: (v) => (isValidApiUrlLoose(v) ? true : '请输入有效的 http:// 或 https:// 地址'),
  }, { onCancel });
  const baseUrl = rawUrl.trim();

  const { apiKey } = await prompts({
    type: 'password',
    name: 'apiKey',
    message: 'Auth Token（输入不回显）',
    validate: (v) => (v && v.length > 0 ? true : 'Auth Token 不能为空'),
  }, { onCancel });

  const ids = await fetchModelIds({ baseUrl, authType, apiKey });

  const model = await pickModel(ids);

  const tierModels = await pickTierModels(ids, model);

  return buildSettings({ baseUrl, apiKey, model, authType, tierModels });
}

/**
 * 拉取端点模型列表；失败或为空时打印原因并返回空数组（调用方回退手动输入）。
 * 错误信息由 models 模块保证不含密钥。
 */
async function fetchModelIds({ baseUrl, authType, apiKey }) {
  try {
    process.stdout.write('正在拉取可用模型…\n');
    const ids = await fetchModels(baseUrl, { authType, key: apiKey });
    if (!ids.length) {
      console.log('端点未返回任何模型，改为手动输入。');
    }
    return ids;
  } catch (err) {
    console.log(`拉取模型失败（${err.message}），改为手动输入。`);
    return [];
  }
}

/**
 * 从已拉取的模型列表选择主模型；列表为空回退手动输入。
 * 始终追加「自定义（手动输入）」选项。
 */
async function pickModel(ids) {
  if (!ids.length) {
    return manualModel();
  }

  const choices = ids.map((id) => ({ title: id, value: id }));
  choices.push({ title: '自定义（手动输入）…', value: CUSTOM_MODEL });

  const { choice } = await prompts({
    type: 'select',
    name: 'choice',
    message: '选择模型',
    choices,
  }, { onCancel });

  return choice === CUSTOM_MODEL ? manualModel() : choice;
}

/**
 * Claude Code 的模型档位：未单独配置时各档位回落到 ANTHROPIC_MODEL。
 */
const MODEL_TIERS = [
  { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', label: 'Opus' },
  { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', label: 'Sonnet' },
  { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', label: 'Haiku' },
  { key: 'ANTHROPIC_DEFAULT_FABLE_MODEL', label: 'Fable' },
];

/**
 * 可选步骤：为各档位单独映射模型（中转端常见用法：全部档位指向同一模型，
 * 或按档位分流到不同模型）。默认不配置，保持单模型行为。
 *
 * @param {string[]} ids 已拉取的模型列表（为空时只提供沿用/自定义）。
 * @param {string} primaryModel 主模型（ANTHROPIC_MODEL）。
 * @returns {Object} 形如 { ANTHROPIC_DEFAULT_OPUS_MODEL: 'k3' } 的映射。
 */
async function pickTierModels(ids, primaryModel) {
  const { want } = await prompts({
    type: 'confirm',
    name: 'want',
    message: '需要为 Opus/Sonnet/Haiku/Fable 档位单独映射模型吗？（默认否，各档位沿用主模型）',
    initial: false,
  }, { onCancel });
  if (!want) return {};

  const tierModels = {};
  for (const tier of MODEL_TIERS) {
    const choices = [
      { title: '不设置（回落到主模型）', value: '' },
      { title: `沿用主模型（${primaryModel}）`, value: primaryModel },
      ...ids.filter((id) => id !== primaryModel).map((id) => ({ title: id, value: id })),
      { title: '自定义（手动输入）…', value: CUSTOM_MODEL },
    ];
    const { choice } = await prompts({
      type: 'select',
      name: 'choice',
      message: `${tier.label} 档位映射到哪个模型`,
      choices,
      initial: 1,
    }, { onCancel });
    if (!choice) continue;
    tierModels[tier.key] = choice === CUSTOM_MODEL ? await manualModel() : choice;
  }
  return tierModels;
}

async function manualModel() {
  const res = await prompts({
    type: 'text',
    name: 'model',
    message: '输入模型名',
    validate: (v) => (v && v.trim().length > 0 ? true : '模型名不能为空'),
  }, { onCancel });
  return res.model.trim();
}

function isValidApiUrlLoose(v) {
  try {
    assertValidApiUrl((v || '').trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * 编辑器模式：打开空白文件，用户自行编写完整 JSON，保存后做 JSON 校验。
 */
async function editorInput() {
  const edited = editInEditor('', { suffix: '.json' });
  if (!edited.trim()) {
    throw new Error('配置内容为空');
  }
  let parsed;
  try {
    parsed = JSON.parse(edited);
  } catch (err) {
    throw new Error(`JSON 校验失败: ${err.message}`);
  }
  return parsed;
}

/**
 * 展示脱敏预览并请求确认。
 */
async function confirmPreview(name, settings) {
  const masked = maskSettingsForDisplay(settings);
  console.log('');
  console.log(`将创建配置档: ${name}`);
  console.log(JSON.stringify(masked, null, 2));
  console.log('');
  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message: '确认保存？',
    initial: true,
  }, { onCancel });
  return ok;
}

/**
 * 创建配置档主流程。
 * @param {string|undefined} presetName 非交互入口传入的名称。
 */
async function runCreate(presetName) {
  try {
    // 1. 名称
    let name = presetName;
    if (name) {
      assertValidNewProfileName(name);
    } else {
      const res = await prompts({
        type: 'text',
        name: 'name',
        message: '配置档名称',
        validate: (v) => {
          const t = (v || '').trim();
          if (!isValidProfileName(t)) return '名称只能包含字母、数字、短横线或下划线';
          if (isReservedProfileName(t)) return '该名称是保留字（copy 的来源标识），请换一个';
          return true;
        },
      }, { onCancel });
      name = res.name.trim();
    }

    if (profiles.profileExists(name)) {
      throw new Error(`配置档已存在: ${name}`);
    }

    // 2. 选择录入方式
    const { method } = await prompts({
      type: 'select',
      name: 'method',
      message: '选择创建方式',
      choices: [
        { title: '从空白配置开始引导填写', value: 'guided' },
        { title: '在编辑器中编辑 JSON', value: 'editor' },
      ],
      initial: 0,
    }, { onCancel });

    // 3. 录入
    const settings = method === 'editor' ? await editorInput() : await guidedInput();

    // 4. 预览并确认
    const ok = await confirmPreview(name, settings);
    if (!ok) {
      console.log('已取消，未创建任何配置档。');
      return;
    }

    // 5. 保存（原子写入 + 权限）
    profiles.createProfile(name, settings);
    console.log(`已创建配置档: ${name}`);
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，未创建任何配置档。');
      return;
    }
    throw err;
  }
}

module.exports = { runCreate, buildSettings, CancelError };
