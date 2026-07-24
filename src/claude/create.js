'use strict';

const prompts = require('../lib/prompt');
const profiles = require('../lib/profiles');
const { assertValidProfileName, isValidProfileName, assertValidApiUrl } = require('../lib/validate');
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
 */
function buildSettings({ baseUrl, apiKey, model, authType = 'api_key' }) {
  const env = { ANTHROPIC_BASE_URL: baseUrl };
  if (authType === 'bearer') env.ANTHROPIC_AUTH_TOKEN = apiKey;
  else env.ANTHROPIC_API_KEY = apiKey;
  if (model) env.ANTHROPIC_MODEL = model;
  return { env };
}

/**
 * 交互式引导填写：URL、隐藏输入 Key、动态拉取并选择模型。
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

  const model = await pickModel({ baseUrl, authType, apiKey });

  return buildSettings({ baseUrl, apiKey, model, authType });
}

/**
 * 尝试从端点动态拉取模型列表供选择；失败则回退为手动输入。
 * 始终追加「自定义（手动输入）」选项。
 */
async function pickModel({ baseUrl, authType, apiKey }) {
  let ids = [];
  try {
    process.stdout.write('正在拉取可用模型…\n');
    ids = await fetchModels(baseUrl, { authType, key: apiKey });
  } catch (err) {
    // 错误信息由 models 模块保证不含密钥。
    console.log(`拉取模型失败（${err.message}），改为手动输入。`);
    return manualModel();
  }

  if (!ids.length) {
    console.log('端点未返回任何模型，改为手动输入。');
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

function isValidApiUrlLoose(v) {
  try {
    assertValidApiUrl((v || '').trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * 编辑器模式：给出一份模板，用户编辑后做 JSON 校验。
 */
async function editorInput() {
  const template = JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'kimi-k2-0905-preview',
      },
    },
    null,
    2,
  );
  const edited = editInEditor(template + '\n', { suffix: '.json' });
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
