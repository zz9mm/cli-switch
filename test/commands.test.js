'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const profiles = require('../src/lib/profiles');
const state = require('../src/lib/state');
const codexStore = require('../src/codex/store');
const { buildSettings } = require('../src/claude/create');
const { buildToml } = require('../src/codex/create');
const { runUse: runClaudeUse, runCurrent: runClaudeCurrent } = require('../src/claude/use');
const { runCopy: runClaudeCopy } = require('../src/claude/copy');
const { runShow: runClaudeShow } = require('../src/claude/show');
const { runDelete: runClaudeDelete } = require('../src/claude/delete');
const { runUse: runCodexUse, runCurrent: runCodexCurrent } = require('../src/codex/use');
const { runCopy: runCodexCopy } = require('../src/codex/copy');
const { runShow: runCodexShow } = require('../src/codex/show');
const { runDelete: runCodexDelete } = require('../src/codex/delete');

function setupEnv(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.CLIS_CONFIG_HOME = path.join(tmp, 'clis-config');
  process.env.CLAUDE_HOME = path.join(tmp, 'claude-home');
  process.env.CODEX_HOME = path.join(tmp, 'codex-home');
  return {
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
      delete process.env.CLIS_CONFIG_HOME;
      delete process.env.CLAUDE_HOME;
      delete process.env.CODEX_HOME;
    },
  };
}

async function captureLogs(run) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return logs.join('\n');
}

test('Claude 非交互命令串联切换、查看、复制和删除', async () => {
  const env = setupEnv('clis-commands-claude-');
  const previousExitCode = process.exitCode;
  try {
    const secret = 'sk-claude-command-secret';
    profiles.createProfile('source', buildSettings({
      baseUrl: 'https://claude.example.com', apiKey: secret, model: 'claude-model', authType: 'api_key',
    }));

    const output = await captureLogs(async () => {
      await runClaudeUse('source');
      runClaudeCurrent();
      await runClaudeShow('source');
      await runClaudeCopy('source', 'copied');
      await runClaudeUse('copied');

      await runClaudeDelete('copied', { yes: false });
      assert.strictEqual(profiles.profileExists('copied'), true);
      assert.strictEqual(process.exitCode, 1);
      process.exitCode = previousExitCode;

      await runClaudeDelete('copied', { yes: true });
    });

    assert.match(output, /已切换为配置档: source/);
    assert.match(output, /当前配置档: source/);
    assert.match(output, /已复制 配置档 source → 配置档 copied/);
    assert.match(output, /非交互模式需追加 --yes/);
    assert.match(output, /已删除配置档: copied/);
    assert.ok(!output.includes(secret));
    assert.strictEqual(profiles.profileExists('copied'), false);
    assert.strictEqual(state.readCurrentProfile(), null);
  } finally {
    process.exitCode = previousExitCode;
    env.cleanup();
  }
});

test('Codex 非交互命令串联受管切换、查看、复制和删除', async () => {
  const env = setupEnv('clis-commands-codex-');
  const previousExitCode = process.exitCode;
  try {
    const secret = 'sk-codex-command-secret';
    const toml = buildToml({
      provider: 'custom',
      baseUrl: 'https://codex.example.com',
      wireApi: 'responses',
      model: 'gpt-command',
      reasoningEffort: 'high',
    });
    codexStore.createProfile('source', { toml, auth: { OPENAI_API_KEY: secret } });

    const output = await captureLogs(async () => {
      await runCodexUse('source');
      runCodexCurrent();
      await runCodexShow('source');
      await runCodexCopy('source', 'copied');
      await runCodexUse('copied');

      await runCodexDelete('copied', { yes: false });
      assert.strictEqual(codexStore.profileExists('copied'), true);
      assert.strictEqual(process.exitCode, 1);
      process.exitCode = previousExitCode;

      await runCodexDelete('copied', { yes: true });
    });

    assert.match(output, /已切换为配置档: source/);
    assert.match(output, /当前配置档: source/);
    assert.match(output, /已复制 配置档 source → 配置档 copied/);
    assert.match(output, /非交互模式需追加 --yes/);
    assert.match(output, /已删除配置档: copied/);
    assert.ok(!output.includes(secret));
    assert.strictEqual(codexStore.profileExists('copied'), false);
    assert.strictEqual(state.codexState.readCurrentProfile(), null);
  } finally {
    process.exitCode = previousExitCode;
    env.cleanup();
  }
});
