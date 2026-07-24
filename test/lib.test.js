'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isValidProfileName, isValidApiUrl } = require('../src/lib/validate');
const { maskSecret, maskSettingsForDisplay } = require('../src/lib/mask');
const { buildSettings } = require('../src/claude/create');
const { modelsUrl, extractModelIds } = require('../src/lib/models');

test('名称校验', () => {
  assert.ok(isValidProfileName('work_1'));
  assert.ok(isValidProfileName('my-profile'));
  assert.ok(!isValidProfileName('bad name'));
  assert.ok(!isValidProfileName('../escape'));
  assert.ok(!isValidProfileName(''));
});

test('API URL 校验', () => {
  assert.ok(isValidApiUrl('https://api.anthropic.com'));
  assert.ok(isValidApiUrl('http://localhost:8080'));
  assert.ok(!isValidApiUrl('ftp://x'));
  assert.ok(!isValidApiUrl('not-a-url'));
  assert.ok(!isValidApiUrl(''));
});

test('密钥脱敏保留头尾', () => {
  assert.strictEqual(maskSecret('short'), '*****');
  const masked = maskSecret('sk-ant-1234567890abcdef');
  assert.ok(masked.startsWith('sk-a'));
  assert.ok(masked.endsWith('cdef'));
  assert.ok(!masked.includes('567890'));
});

test('展示用 settings 脱敏 API Key', () => {
  const s = buildSettings({ baseUrl: 'https://x', apiKey: 'sk-ant-secret-value-123', model: 'claude-fable-5' });
  const masked = maskSettingsForDisplay(s);
  assert.notStrictEqual(masked.env.ANTHROPIC_API_KEY, s.env.ANTHROPIC_API_KEY);
  // 原对象未被修改
  assert.strictEqual(s.env.ANTHROPIC_API_KEY, 'sk-ant-secret-value-123');
});

test('buildSettings 鉴权方式：api_key vs bearer', () => {
  const a = buildSettings({ baseUrl: 'https://x', apiKey: 'k1', model: 'm', authType: 'api_key' });
  assert.strictEqual(a.env.ANTHROPIC_API_KEY, 'k1');
  assert.ok(!('ANTHROPIC_AUTH_TOKEN' in a.env));

  const b = buildSettings({ baseUrl: 'https://x', apiKey: 'k2', model: 'm', authType: 'bearer' });
  assert.strictEqual(b.env.ANTHROPIC_AUTH_TOKEN, 'k2');
  assert.ok(!('ANTHROPIC_API_KEY' in b.env));

  // 默认走 api_key
  const c = buildSettings({ baseUrl: 'https://x', apiKey: 'k3' });
  assert.strictEqual(c.env.ANTHROPIC_API_KEY, 'k3');
});

test('脱敏同时覆盖 AUTH_TOKEN', () => {
  const s = buildSettings({ baseUrl: 'https://x', apiKey: 'sk-bearer-secret-9999', authType: 'bearer' });
  const masked = maskSettingsForDisplay(s);
  assert.notStrictEqual(masked.env.ANTHROPIC_AUTH_TOKEN, s.env.ANTHROPIC_AUTH_TOKEN);
  assert.ok(!masked.env.ANTHROPIC_AUTH_TOKEN.includes('secret'));
});

test('modelsUrl 正确拼接、去重尾斜杠', () => {
  assert.strictEqual(modelsUrl('https://api.anthropic.com'), 'https://api.anthropic.com/v1/models');
  assert.strictEqual(modelsUrl('https://api.kimi.com/coding/'), 'https://api.kimi.com/coding/v1/models');
  assert.strictEqual(modelsUrl('https://x//'), 'https://x/v1/models');
});

test('extractModelIds 兼容 data/models 两种结构并去重', () => {
  assert.deepStrictEqual(extractModelIds({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }), ['a', 'b']);
  assert.deepStrictEqual(extractModelIds({ models: [{ name: 'x' }, 'y'] }), ['x', 'y']);
  assert.deepStrictEqual(extractModelIds({}), []);
  assert.deepStrictEqual(extractModelIds({ data: 'nope' }), []);
});

test('createProfile 原子写入并设置权限', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clis-test-'));
  process.env.CLIS_CONFIG_HOME = tmp;
  // 延迟 require 以确保读到覆盖后的 env
  delete require.cache[require.resolve('../src/lib/profiles')];
  const profiles = require('../src/lib/profiles');

  const settings = buildSettings({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-secret', model: 'claude-fable-5' });
  profiles.createProfile('demo', settings);

  assert.ok(profiles.profileExists('demo'));
  const read = profiles.readSettings('demo');
  assert.strictEqual(read.env.ANTHROPIC_API_KEY, 'sk-secret');

  if (process.platform !== 'win32') {
    const settingsPath = path.join(tmp, 'claude', 'profiles', 'demo', 'settings.json');
    const mode = fs.statSync(settingsPath).mode & 0o777;
    assert.strictEqual(mode, 0o600);
    const dirMode = fs.statSync(path.join(tmp, 'claude', 'profiles', 'demo')).mode & 0o777;
    assert.strictEqual(dirMode, 0o700);
  }

  // 重复创建应报错
  assert.throws(() => profiles.createProfile('demo', settings), /已存在/);

  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CLIS_CONFIG_HOME;
});

test('deleteProfile 删除目录、防穿越、清理当前状态', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clis-del-'));
  process.env.CLIS_CONFIG_HOME = tmp;
  delete require.cache[require.resolve('../src/lib/profiles')];
  delete require.cache[require.resolve('../src/lib/state')];
  const profiles = require('../src/lib/profiles');
  const state = require('../src/lib/state');

  const s = buildSettings({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
  profiles.createProfile('keep', s);
  profiles.createProfile('gone', s);

  // 非法名称应被拒绝（防路径穿越）
  assert.throws(() => profiles.deleteProfile('../evil'), /名称只能/);
  assert.throws(() => profiles.deleteProfile('a/b'), /名称只能/);

  // 标记 gone 为当前配置档，模拟删除流程：删目录 + 清状态
  state.setCurrentProfile('gone', '2026-01-01T00:00:00Z');
  assert.strictEqual(state.readCurrentProfile(), 'gone');

  profiles.deleteProfile('gone');
  assert.ok(!profiles.profileExists('gone'));
  assert.ok(profiles.profileExists('keep'));      // 其余配置档完整
  assert.strictEqual(state.clearCurrentIfMatches('gone'), true); // 删的是当前档 → 清除
  assert.strictEqual(state.readCurrentProfile(), null);

  // 删除非当前配置档不应影响当前状态
  state.setCurrentProfile('keep', '2026-01-01T00:00:00Z');
  assert.strictEqual(state.clearCurrentIfMatches('other'), false);
  assert.strictEqual(state.readCurrentProfile(), 'keep');

  // 删除不存在的配置档应报错
  assert.throws(() => profiles.deleteProfile('nope'), /不存在/);

  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CLIS_CONFIG_HOME;
});
