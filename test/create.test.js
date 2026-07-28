'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { guidedInput: claudeGuidedInput } = require('../src/claude/create');
const { guidedInput: codexGuidedInput } = require('../src/codex/create');
const { summarizeToml } = require('../src/lib/toml');

function scriptedPrompt(values, questions = []) {
  const queue = values.slice();
  return async (question) => {
    questions.push(question);
    assert.ok(queue.length > 0, `缺少问题 ${question.name} 的脚本答案`);
    return { [question.name]: queue.shift() };
  };
}

test('Claude 创建向导覆盖鉴权选择、模型列表与档位映射', async () => {
  const questions = [];
  const ask = scriptedPrompt([
    'bearer',
    'https://claude.example.com/',
    'claude-secret',
    'model-b',
    true,
    'model-b',
    '__custom__',
    'sonnet-custom',
    '',
    'model-a',
  ], questions);
  let fetchArgs;
  const settings = await claudeGuidedInput({
    ask,
    fetchIds: async (args) => {
      fetchArgs = args;
      return ['model-a', 'model-b'];
    },
  });

  assert.deepStrictEqual(fetchArgs, {
    baseUrl: 'https://claude.example.com/', authType: 'bearer', apiKey: 'claude-secret',
  });
  assert.deepStrictEqual(settings.env, {
    ANTHROPIC_BASE_URL: 'https://claude.example.com/',
    ANTHROPIC_AUTH_TOKEN: 'claude-secret',
    ANTHROPIC_MODEL: 'model-b',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'model-b',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-custom',
    ANTHROPIC_DEFAULT_FABLE_MODEL: 'model-a',
  });
  assert.strictEqual(questions[0].choices.length, 2);
  assert.ok(questions.some((question) => question.message.includes('Sonnet')));
});

test('Claude 创建向导在模型列表为空时回退手动输入', async () => {
  const ask = scriptedPrompt([
    'api_key', 'https://api.anthropic.com', 'api-secret', 'manual-model', false,
  ]);
  const settings = await claudeGuidedInput({ ask, fetchIds: async () => [] });

  assert.strictEqual(settings.env.ANTHROPIC_API_KEY, 'api-secret');
  assert.strictEqual(settings.env.ANTHROPIC_MODEL, 'manual-model');
  assert.ok(!('ANTHROPIC_AUTH_TOKEN' in settings.env));
  assert.ok(!Object.keys(settings.env).some((key) => key.startsWith('ANTHROPIC_DEFAULT_')));
});

test('Codex 创建向导覆盖 provider、模型选择与推理强度', async () => {
  const questions = [];
  const ask = scriptedPrompt([
    ' custom-provider ',
    'https://codex.example.com/',
    'responses',
    'codex-secret',
    'gpt-b',
    'xhigh',
  ], questions);
  let fetchArgs;
  const profile = await codexGuidedInput({
    ask,
    fetchIds: async (args) => {
      fetchArgs = args;
      return ['gpt-a', 'gpt-b'];
    },
  });

  assert.deepStrictEqual(fetchArgs, {
    baseUrl: 'https://codex.example.com/', apiKey: 'codex-secret',
  });
  assert.deepStrictEqual(profile.auth, { OPENAI_API_KEY: 'codex-secret' });
  assert.deepStrictEqual(summarizeToml(profile.toml), {
    model: 'gpt-b',
    provider: 'custom-provider',
    reasoningEffort: 'xhigh',
    baseUrl: 'https://codex.example.com/',
    wireApi: 'responses',
  });
  assert.ok(questions.some((question) => question.name === 'reasoningEffort'));
});

test('Codex 创建向导在模型列表为空时回退手动输入', async () => {
  const ask = scriptedPrompt([
    'custom', 'https://codex.example.com', 'chat', 'codex-secret', 'manual-gpt', '',
  ]);
  const profile = await codexGuidedInput({ ask, fetchIds: async () => [] });
  const summary = summarizeToml(profile.toml);

  assert.strictEqual(summary.model, 'manual-gpt');
  assert.strictEqual(summary.wireApi, 'chat');
  assert.strictEqual(summary.reasoningEffort, '');
});
