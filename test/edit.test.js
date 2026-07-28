'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const profiles = require('../src/lib/profiles');
const codexStore = require('../src/codex/store');
const { editViaGuided: editClaudeViaGuided } = require('../src/claude/show');
const { editViaGuided: editCodexViaGuided } = require('../src/codex/show');
const { buildToml } = require('../src/codex/create');
const { summarizeToml } = require('../src/lib/toml');

function setupEnv(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.CLIS_CONFIG_HOME = path.join(tmp, 'clis-config');
  return {
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
      delete process.env.CLIS_CONFIG_HOME;
    },
  };
}

function scriptedPrompt(values) {
  const queue = values.slice();
  return async (question) => {
    assert.ok(queue.length, `缺少问题 ${question.name} 的答案`);
    return { [question.name]: queue.shift() };
  };
}

async function silenceLogs(run) {
  const original = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = original;
  }
}

test('Claude 引导编辑更新字段并保留高级配置与鉴权类型', async () => {
  const env = setupEnv('clis-edit-claude-');
  try {
    profiles.createProfile('work', {
      env: {
        ANTHROPIC_BASE_URL: 'https://old.example.com',
        ANTHROPIC_AUTH_TOKEN: 'old-token',
        ANTHROPIC_MODEL: 'old-model',
        CUSTOM_ENV: 'keep-me',
      },
      hooks: { PreToolUse: [] },
    });
    let preview;
    await silenceLogs(() => editClaudeViaGuided('work', {
      ask: scriptedPrompt(['https://new.example.com', 'new-token', 'new-model']),
      confirm: async (name, settings) => {
        preview = { name, settings };
        return true;
      },
    }));

    const settings = profiles.readSettings('work');
    assert.strictEqual(preview.name, 'work');
    assert.strictEqual(settings.env.ANTHROPIC_BASE_URL, 'https://new.example.com');
    assert.strictEqual(settings.env.ANTHROPIC_AUTH_TOKEN, 'new-token');
    assert.ok(!('ANTHROPIC_API_KEY' in settings.env));
    assert.strictEqual(settings.env.ANTHROPIC_MODEL, 'new-model');
    assert.strictEqual(settings.env.CUSTOM_ENV, 'keep-me');
    assert.deepStrictEqual(settings.hooks, { PreToolUse: [] });
  } finally {
    env.cleanup();
  }
});

test('Claude 引导编辑全部留空时不写入配置', async () => {
  const env = setupEnv('clis-edit-claude-empty-');
  try {
    profiles.createProfile('work', { env: { ANTHROPIC_MODEL: 'same' } });
    const before = fs.readFileSync(
      path.join(process.env.CLIS_CONFIG_HOME, 'claude', 'profiles', 'work', 'settings.json'),
      'utf8',
    );
    let confirmed = false;
    await silenceLogs(() => editClaudeViaGuided('work', {
      ask: scriptedPrompt(['', '', '']),
      confirm: async () => { confirmed = true; return true; },
    }));
    const after = fs.readFileSync(
      path.join(process.env.CLIS_CONFIG_HOME, 'claude', 'profiles', 'work', 'settings.json'),
      'utf8',
    );
    assert.strictEqual(after, before);
    assert.strictEqual(confirmed, false);
  } finally {
    env.cleanup();
  }
});

test('Codex 引导编辑保留 requires_openai_auth=false 并更新密钥', async () => {
  const env = setupEnv('clis-edit-codex-');
  try {
    const original = buildToml({
      provider: 'custom',
      baseUrl: 'https://old.example.com',
      wireApi: 'chat',
      model: 'old-model',
      reasoningEffort: 'medium',
      requiresOpenaiAuth: false,
    });
    codexStore.createProfile('work', { toml: original, auth: { OPENAI_API_KEY: 'old-key' } });
    let preview;
    await silenceLogs(() => editCodexViaGuided('work', {
      ask: scriptedPrompt(['https://new.example.com', 'new-key', 'new-model', 'xhigh']),
      confirm: async (name, profile) => {
        preview = { name, profile };
        return true;
      },
    }));

    const toml = codexStore.readConfigToml('work');
    const summary = summarizeToml(toml);
    assert.strictEqual(preview.name, 'work');
    assert.strictEqual(summary.baseUrl, 'https://new.example.com');
    assert.strictEqual(summary.model, 'new-model');
    assert.strictEqual(summary.reasoningEffort, 'xhigh');
    assert.strictEqual(summary.wireApi, 'chat');
    assert.match(toml, /requires_openai_auth = false/);
    assert.deepStrictEqual(codexStore.readAuth('work'), { OPENAI_API_KEY: 'new-key' });
  } finally {
    env.cleanup();
  }
});

test('Codex 引导编辑拒绝重建含高级字段的 provider', async () => {
  const env = setupEnv('clis-edit-codex-advanced-');
  try {
    const advanced = `${buildToml({
      provider: 'custom', baseUrl: 'https://x', wireApi: 'responses', model: 'm', reasoningEffort: '',
    }).trim()}\nhttp_headers = { X-Test = "value" }\n`;
    codexStore.createProfile('work', { toml: advanced, auth: null });
    let asked = false;
    await silenceLogs(() => editCodexViaGuided('work', {
      ask: async () => { asked = true; return {}; },
      confirm: async () => true,
    }));
    assert.strictEqual(asked, false);
    assert.strictEqual(codexStore.readConfigToml('work'), advanced);
  } finally {
    env.cleanup();
  }
});
