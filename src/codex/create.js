'use strict';

const prompts = require('../lib/prompt');
const store = require('./store');
const { assertValidProfileName, isValidProfileName, isValidApiUrl } = require('../lib/validate');
const { maskSecret } = require('../lib/mask');
const { editInEditor } = require('../lib/editor');
const { fetchModels } = require('../lib/models');
const { assertValidManagedToml, tomlString } = require('../lib/toml');

const CUSTOM_MODEL = '__custom__';

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

const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

/**
 * 由引导输入构造受管 TOML 片段。
 * 只包含 clis 受管的内容：模型/provider 顶层键 + [model_providers.<name>]。
 */
function buildToml({ provider, baseUrl, wireApi, model, reasoningEffort }) {
  const lines = [
    `model_provider = ${tomlString(provider)}`,
    `model = ${tomlString(model)}`,
  ];
  if (reasoningEffort) lines.push(`model_reasoning_effort = ${tomlString(reasoningEffort)}`);
  lines.push(
    '',
    `[model_providers.${provider}]`,
    `name = ${tomlString(provider)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `wire_api = ${tomlString(wireApi)}`,
    'requires_openai_auth = true',
  );
  return lines.join('\n') + '\n';
}

/**
 * 交互式引导填写：provider 名、URL、隐藏输入 Key、动态拉取并选择模型、推理强度。
 * Codex 中转端统一走 Bearer（auth.json 的 OPENAI_API_KEY）。
 */
async function guidedInput() {
  const { provider: rawProvider } = await prompts({
    type: 'text',
    name: 'provider',
    message: 'Provider 名称（config.toml 中的 [model_providers.<名称>]）',
    initial: 'custom',
    validate: (v) => (isValidProfileName((v || '').trim()) ? true : '只能包含字母、数字、短横线或下划线'),
  }, { onCancel });
  const provider = rawProvider.trim();

  const { baseUrl: rawUrl } = await prompts({
    type: 'text',
    name: 'baseUrl',
    message: 'API URL',
    validate: (v) => (isValidApiUrl((v || '').trim()) ? true : '请输入有效的 http:// 或 https:// 地址'),
  }, { onCancel });
  const baseUrl = rawUrl.trim();

  const { wireApi } = await prompts({
    type: 'select',
    name: 'wireApi',
    message: 'Wire API（中转端多为 responses）',
    choices: [
      { title: 'responses', value: 'responses' },
      { title: 'chat', value: 'chat' },
    ],
    initial: 0,
  }, { onCancel });

  const { apiKey } = await prompts({
    type: 'password',
    name: 'apiKey',
    message: 'API Key（输入不回显）',
    validate: (v) => (v && v.length > 0 ? true : 'API Key 不能为空'),
  }, { onCancel });

  const ids = await fetchModelIds({ baseUrl, apiKey });

  const model = await pickModel(ids);

  const { reasoningEffort } = await prompts({
    type: 'select',
    name: 'reasoningEffort',
    message: '推理强度（model_reasoning_effort）',
    choices: [
      ...REASONING_EFFORTS.map((e) => ({ title: e, value: e })),
      { title: '不设置（跟随 Codex 默认）', value: '' },
    ],
    initial: 2,
  }, { onCancel });

  return {
    toml: buildToml({ provider, baseUrl, wireApi, model, reasoningEffort }),
    auth: { OPENAI_API_KEY: apiKey },
  };
}

/**
 * 拉取端点模型列表；失败或为空时打印原因并返回空数组（调用方回退手动输入）。
 * 错误信息由 models 模块保证不含密钥。
 */
async function fetchModelIds({ baseUrl, apiKey }) {
  try {
    process.stdout.write('正在拉取可用模型…\n');
    const ids = await fetchModels(baseUrl, { authType: 'bearer', key: apiKey });
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
 * 从已拉取的模型列表选择模型；列表为空回退手动输入。
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

async function manualModel() {
  const res = await prompts({
    type: 'text',
    name: 'model',
    message: '输入模型名',
    validate: (v) => (v && v.trim().length > 0 ? true : '模型名不能为空'),
  }, { onCancel });
  return res.model.trim();
}

/**
 * 编辑器模式：打开空白文件，用户自行编写受管 TOML 片段。
 * 只允许受管顶层键与 [model_providers.*]，防止把本机状态写进配置档。
 * API Key 单独以无回显方式询问（可留空，配置档则不管理密钥）。
 */
async function editorInput() {
  const edited = editInEditor('', { suffix: '.toml' });
  let toml;
  try {
    assertValidManagedToml(edited);
    toml = edited.endsWith('\n') ? edited : edited + '\n';
  } catch (err) {
    throw new Error(`TOML 校验失败: ${err.message}`);
  }

  const { apiKey } = await prompts({
    type: 'password',
    name: 'apiKey',
    message: 'API Key（输入不回显；留空则该配置档不管理密钥）',
  }, { onCancel });

  return { toml, auth: apiKey ? { OPENAI_API_KEY: apiKey } : null };
}

/**
 * 展示预览（TOML 全文 + 脱敏密钥）并请求确认。
 */
async function confirmPreview(name, { toml, auth }) {
  console.log('');
  console.log(`将创建配置档: ${name}`);
  console.log(toml);
  const key = auth && typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';
  console.log(`  API Key: ${key ? maskSecret(key) : '(不管理密钥)'}`);
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
      assertValidProfileName(name);
    } else {
      const res = await prompts({
        type: 'text',
        name: 'name',
        message: '配置档名称',
        validate: (v) => (isValidProfileName((v || '').trim()) ? true : '名称只能包含字母、数字、短横线或下划线'),
      }, { onCancel });
      name = res.name.trim();
    }

    if (store.profileExists(name)) {
      throw new Error(`配置档已存在: ${name}`);
    }

    // 2. 选择录入方式
    const { method } = await prompts({
      type: 'select',
      name: 'method',
      message: '选择创建方式',
      choices: [
        { title: '从空白配置开始引导填写', value: 'guided' },
        { title: '在编辑器中编辑 TOML', value: 'editor' },
      ],
      initial: 0,
    }, { onCancel });

    // 3. 录入
    const profile = method === 'editor' ? await editorInput() : await guidedInput();

    // 4. 预览并确认
    const ok = await confirmPreview(name, profile);
    if (!ok) {
      console.log('已取消，未创建任何配置档。');
      return;
    }

    // 5. 保存（原子写入 + 权限）
    store.createProfile(name, profile);
    console.log(`已创建配置档: ${name}`);
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，未创建任何配置档。');
      return;
    }
    throw err;
  }
}

module.exports = { runCreate, buildToml, CancelError };
