'use strict';

const prompts = require('../lib/prompt');
const store = require('./store');
const { assertValidProfileName, isValidApiUrl } = require('../lib/validate');
const { maskSecret } = require('../lib/mask');
const { editInEditor } = require('../lib/editor');
const { assertValidManagedToml, summarizeToml, splitToml, isManagedSection } = require('../lib/toml');
const { buildToml } = require('./create');

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
  const meta = store.readMeta(name);
  let s = { model: '', provider: '', reasoningEffort: '', baseUrl: '', wireApi: '' };
  let broken = null;
  try {
    s = summarizeToml(store.readConfigToml(name));
  } catch (err) {
    broken = err.message;
  }
  const auth = store.readAuth(name);
  const key = auth && typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';
  return {
    name,
    model: s.model,
    provider: s.provider,
    reasoningEffort: s.reasoningEffort,
    baseUrl: s.baseUrl,
    maskedKey: key ? maskSecret(key) : '(不管理密钥)',
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
    console.log(`  配置读取失败: ${s.broken}`);
  } else {
    console.log(`  模型: ${s.model || '(未设置)'}`);
    console.log(`  Provider: ${s.provider || '(未设置)'}`);
    console.log(`  API URL: ${s.baseUrl || '(未设置)'}`);
    console.log(`  推理强度: ${s.reasoningEffort || '(未设置)'}`);
    console.log(`  API Key: ${s.maskedKey}`);
  }
  console.log(`  创建时间: ${s.createdAt || '(未知)'}`);
  console.log(`  最近使用: ${s.lastUsedAt || '(从未使用)'}`);
  console.log('');
}

// 交互选择配置档；无配置档时返回 null。
async function pickProfile(message) {
  const names = store.listProfiles();
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
 * clis codex show [名称]：查看配置档摘要（密钥脱敏）。
 * 无名称时进入引导：选择配置档 → 摘要 → 选择后续操作。
 */
async function runShow(presetName) {
  try {
    if (presetName) {
      assertValidProfileName(presetName);
      if (!store.profileExists(presetName)) {
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
        { title: '引导更新 API URL / API Key / 模型 / 推理强度', value: 'guided' },
        { title: '在编辑器中编辑 TOML', value: 'editor' },
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
 * clis codex edit [名称]：编辑配置档。
 * 无名称时先选择配置档，再选择编辑方式。
 */
async function runEdit(presetName) {
  try {
    let name = presetName;
    if (name) {
      assertValidProfileName(name);
      if (!store.profileExists(name)) {
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
        { title: '引导更新 API URL / API Key / 模型 / 推理强度', value: 'guided' },
        { title: '在编辑器中编辑 TOML（高级字段）', value: 'editor' },
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
 * 编辑器模式：临时文件编辑受管 TOML 片段。
 * 只有确认且校验通过时才原子覆盖原配置档；
 * 取消、编辑器异常退出或内容越界时原文件保持不变。
 * API Key 可随后选择是否更新（留空保持不变）。
 */
async function editViaEditor(name) {
  const original = store.readConfigToml(name);
  const edited = editInEditor(original, { suffix: '.toml' });

  let toml;
  try {
    assertValidManagedToml(edited);
    toml = edited.endsWith('\n') ? edited : edited + '\n';
  } catch (err) {
    console.log(`TOML 校验失败（${err.message}），配置档未修改。`);
    return;
  }

  const ok = await confirmSave(name, { toml, auth: store.readAuth(name) });
  if (!ok) return;
  store.createProfile(name, { toml, auth: store.readAuth(name) }, { overwrite: true });
  console.log(`已更新配置档: ${name}`);
}

/**
 * 引导模式：逐项更新 API URL、API Key、模型、推理强度。留空表示保持原值。
 * API Key 无回显输入；其余字段回显当前值供参考。
 * 仅支持标准的单 provider 配置档；自定义结构请用编辑器模式。
 */
async function editViaGuided(name) {
  const original = store.readConfigToml(name);
  // 引导编辑按标准形状重建片段，只允许已知字段，避免静默丢弃用户加的高级字段。
  const STANDARD_SECTION_KEYS = ['name', 'base_url', 'wire_api', 'requires_openai_auth'];
  const parsed = splitToml(original);
  const providerSections = parsed.sections.filter((s) => isManagedSection(s.name));
  const hasOnlyStandardKeys = providerSections.length === 1
    && providerSections[0].lines.every((line) => {
      const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
      return !kv || STANDARD_SECTION_KEYS.includes(kv[1]);
    });
  if (!hasOnlyStandardKeys) {
    console.log('该配置档不是标准的单 provider 结构（或含高级字段），请改用编辑器模式。');
    return;
  }

  const s = summarizeToml(original);
  const auth = store.readAuth(name);
  const curKey = auth && typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';

  // 读出原 section 的 requires_openai_auth，重建时原样保留（默认 true）。
  const authFlagLine = providerSections[0].lines.find((l) => /^\s*requires_openai_auth\s*=/.test(l));
  const authFlagMatch = authFlagLine && authFlagLine.match(/=\s*(true|false)/);
  const curRequiresAuth = authFlagMatch ? authFlagMatch[1] === 'true' : true;

  const urlRes = await prompts({
    type: 'text',
    name: 'baseUrl',
    message: `API URL（当前: ${s.baseUrl || '(未设置)'}，留空保持不变）`,
    validate: (v) => {
      const t = (v || '').trim();
      if (!t) return true;
      return isValidApiUrl(t) ? true : '请输入有效的 http:// 或 https:// 地址';
    },
  }, { onCancel });

  const keyRes = await prompts({
    type: 'password',
    name: 'apiKey',
    message: `API Key（当前: ${curKey ? maskSecret(curKey) : '(不管理密钥)'}，留空保持不变，输入不回显）`,
  }, { onCancel });

  const modelRes = await prompts({
    type: 'text',
    name: 'model',
    message: `模型（当前: ${s.model || '(未设置)'}，留空保持不变）`,
  }, { onCancel });

  const effortRes = await prompts({
    type: 'text',
    name: 'reasoningEffort',
    message: `推理强度（当前: ${s.reasoningEffort || '(未设置)'}，留空保持不变）`,
    validate: (v) => {
      const t = (v || '').trim();
      if (!t) return true;
      return ['low', 'medium', 'high', 'xhigh'].includes(t) ? true : '可选值: low / medium / high / xhigh';
    },
  }, { onCancel });

  const newUrl = (urlRes.baseUrl || '').trim();
  const newKey = keyRes.apiKey || '';
  const newModel = (modelRes.model || '').trim();
  const newEffort = (effortRes.reasoningEffort || '').trim();

  if (!newUrl && !newKey && !newModel && !newEffort) {
    console.log('未做任何修改。');
    return;
  }

  const toml = buildToml({
    provider: s.provider || providerSections[0].name.replace(/['"\s]/g, '').slice('model_providers.'.length),
    baseUrl: newUrl || s.baseUrl,
    wireApi: s.wireApi || 'responses',
    model: newModel || s.model,
    reasoningEffort: newEffort || s.reasoningEffort,
    requiresOpenaiAuth: curRequiresAuth,
  });
  const nextAuth = newKey ? { OPENAI_API_KEY: newKey } : auth;

  const ok = await confirmSave(name, { toml, auth: nextAuth });
  if (!ok) return;
  store.createProfile(name, { toml, auth: nextAuth }, { overwrite: true });
  console.log(`已更新配置档: ${name}`);
}

// 展示预览（TOML 全文 + 脱敏密钥）并请求确认；拒绝时打印未修改提示。
async function confirmSave(name, { toml, auth }) {
  console.log('');
  console.log(`将更新配置档: ${name}`);
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
  if (!ok) {
    console.log('已取消，配置档未修改。');
    return false;
  }
  return true;
}

module.exports = { runShow, runEdit, profileSummary };
