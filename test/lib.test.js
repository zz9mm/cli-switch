'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');

const { isValidProfileName, isValidApiUrl } = require('../src/lib/validate');
const { maskSecret, maskSettingsForDisplay } = require('../src/lib/mask');
const { buildSettings } = require('../src/claude/create');
const { fetchModels, modelsUrl, extractModelIds } = require('../src/lib/models');
const { backupClaudeSettings } = require('../src/lib/backup');
const { applyProfile } = require('../src/claude/use');
const { readSourceSettings, deepCopy } = require('../src/claude/copy');
const { profileSummary } = require('../src/claude/show');

// 建立隔离的 clis 配置根 + Claude home；返回清理函数。
function setupEnv(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.CLIS_CONFIG_HOME = path.join(tmp, 'clis-config');
  process.env.CLAUDE_HOME = path.join(tmp, 'claude-home');
  const profiles = require('../src/lib/profiles');
  const state = require('../src/lib/state');
  return {
    tmp,
    profiles,
    state,
    claudeSettings: path.join(process.env.CLAUDE_HOME, 'settings.json'),
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
      delete process.env.CLIS_CONFIG_HOME;
      delete process.env.CLAUDE_HOME;
    },
  };
}

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

test('buildSettings 档位映射：写入非空档位，忽略空值与缺省', () => {
  const s = buildSettings({
    baseUrl: 'https://x',
    apiKey: 'k',
    model: 'k3[1M]',
    authType: 'bearer',
    tierModels: {
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'k3[1M]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'k3',
      ANTHROPIC_DEFAULT_SONNET_MODEL: '',
    },
  });
  assert.strictEqual(s.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'k3[1M]');
  assert.strictEqual(s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'k3');
  assert.ok(!('ANTHROPIC_DEFAULT_SONNET_MODEL' in s.env));

  // 缺省 tierModels 时行为与之前一致
  const plain = buildSettings({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
  assert.ok(!Object.keys(plain.env).some((k) => k.startsWith('ANTHROPIC_DEFAULT_')));
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

test('fetchModels 在 Node 16 兼容的内置 HTTP 客户端上发送正确鉴权并解析响应', async () => {
  const requests = [];
  const originalGet = http.get;
  http.get = (_url, { headers }, onResponse) => {
    requests.push(headers);
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = (err) => req.emit('error', err);
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      res.resume = () => {};
      onResponse(res);
      res.emit('data', Buffer.from(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })));
      res.emit('end');
    });
    return req;
  };
  try {
    assert.deepStrictEqual(
      await fetchModels('http://models.test', { authType: 'api_key', key: 'secret-key' }),
      ['model-a', 'model-b'],
    );
    assert.strictEqual(requests[0]['x-api-key'], 'secret-key');
    assert.strictEqual(requests[0]['anthropic-version'], '2023-06-01');

    await fetchModels('http://models.test', { authType: 'bearer', key: 'bearer-key' });
    assert.strictEqual(requests[1].Authorization, 'Bearer bearer-key');
    assert.ok(!requests[1]['x-api-key']);
  } finally {
    http.get = originalGet;
  }
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
  assert.throws(() => profiles.createProfile('array', []), /settings 必须是 JSON 对象/);

  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CLIS_CONFIG_HOME;
});

test('listProfiles 跳过非法名称目录，不崩溃', () => {
  const env = setupEnv('clis-test-list-');
  try {
    env.profiles.createProfile('valid-one', { env: { ANTHROPIC_MODEL: 'm' } });
    // 手放的备份目录 / 编辑器临时目录：含空格、点、中文的非法名称。
    const dir = path.join(process.env.CLIS_CONFIG_HOME, 'claude', 'profiles');
    fs.mkdirSync(path.join(dir, 'backup.old'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'my profile'), { recursive: true });
    fs.mkdirSync(path.join(dir, '旧配置'), { recursive: true });
    assert.deepStrictEqual(env.profiles.listProfiles(), ['valid-one']);
  } finally {
    env.cleanup();
  }
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

test('backupClaudeSettings 备份现有配置，无配置时返回 null', () => {
  const env = setupEnv('clis-bak-');
  try {
    // 没有生效配置 → null
    assert.strictEqual(backupClaudeSettings(), null);

    fs.mkdirSync(process.env.CLAUDE_HOME, { recursive: true });
    fs.writeFileSync(env.claudeSettings, '{"env":{"A":"1"}}\n');
    const p1 = backupClaudeSettings(new Date('2026-07-25T10:00:00.000Z'));
    assert.ok(p1.includes('settings-2026-07-25T10-00-00-000Z'));
    assert.strictEqual(fs.readFileSync(p1, 'utf8'), '{"env":{"A":"1"}}\n');

    // 同一时间戳再次备份 → 追加序号，不覆盖
    const p2 = backupClaudeSettings(new Date('2026-07-25T10:00:00.000Z'));
    assert.notStrictEqual(p1, p2);
    assert.strictEqual(fs.readFileSync(p2, 'utf8'), '{"env":{"A":"1"}}\n');
  } finally {
    env.cleanup();
  }
});

test('applyProfile 备份旧配置、原子写入、更新状态与最近使用时间', () => {
  const env = setupEnv('clis-use-');
  try {
    const { profiles, state } = env;
    const settings = buildSettings({ baseUrl: 'https://api.kimi.example', apiKey: 'sk-secret-123456', model: 'kimi-k2' });
    profiles.createProfile('work', settings);

    // 预置一份旧的生效配置，应被备份
    fs.mkdirSync(process.env.CLAUDE_HOME, { recursive: true });
    fs.writeFileSync(env.claudeSettings, '{"env":{"OLD":"1"}}\n');

    const { backupPath } = applyProfile('work');
    assert.ok(backupPath, '应产生备份');
    assert.strictEqual(fs.readFileSync(backupPath, 'utf8'), '{"env":{"OLD":"1"}}\n');

    // 生效配置与配置档一致（含密钥，写入 ~/.claude 是预期行为）
    const applied = JSON.parse(fs.readFileSync(env.claudeSettings, 'utf8'));
    assert.deepStrictEqual(applied, settings);

    // 状态与元数据更新
    assert.strictEqual(state.readCurrentProfile(), 'work');
    assert.ok(profiles.readMeta('work').lastUsedAt, '应记录最近使用时间');

    // 不存在的配置档与损坏 JSON 都应中止且不改动生效配置
    assert.throws(() => applyProfile('nope'), /不存在/);
    fs.writeFileSync(
      path.join(process.env.CLIS_CONFIG_HOME, 'claude', 'profiles', 'work', 'settings.json'),
      '{bad json',
    );
    const before = fs.readFileSync(env.claudeSettings, 'utf8');
    assert.throws(() => applyProfile('work'), /损坏/);
    assert.strictEqual(fs.readFileSync(env.claudeSettings, 'utf8'), before, '损坏配置不得覆盖生效配置');
  } finally {
    env.cleanup();
  }
});

test('touchLastUsed 保留其余元数据字段', () => {
  const env = setupEnv('clis-touch-');
  try {
    const { profiles } = env;
    profiles.createProfile('a', buildSettings({ baseUrl: 'https://x', apiKey: 'k', model: 'm' }));
    const before = profiles.readMeta('a');
    profiles.touchLastUsed('a', '2026-07-25T12:00:00.000Z');
    const after = profiles.readMeta('a');
    assert.strictEqual(after.lastUsedAt, '2026-07-25T12:00:00.000Z');
    assert.strictEqual(after.createdAt, before.createdAt);
    assert.strictEqual(after.name, 'a');
    assert.throws(() => profiles.touchLastUsed('ghost'), /不存在/);
  } finally {
    env.cleanup();
  }
});

test('copy：来源与目标内容相同、元数据独立、深拷贝互不影响', () => {
  const env = setupEnv('clis-copy-');
  try {
    const { profiles } = env;
    const src = buildSettings({ baseUrl: 'https://x', apiKey: 'sk-1', model: 'm' });
    profiles.createProfile('src', src);

    // 配置档来源
    const copied = readSourceSettings('src');
    assert.deepStrictEqual(copied, src);
    profiles.createProfile('dst', deepCopy(copied));
    assert.deepStrictEqual(profiles.readSettings('dst'), src);
    const srcMeta = profiles.readMeta('src');
    const dstMeta = profiles.readMeta('dst');
    assert.strictEqual(dstMeta.name, 'dst');
    assert.strictEqual(srcMeta.name, 'src');
    assert.ok(!dstMeta.lastUsedAt, '新配置档不应继承使用时间');

    // 深拷贝：改副本不影响来源对象
    copied.env.ANTHROPIC_API_KEY = 'changed';
    assert.strictEqual(src.env.ANTHROPIC_API_KEY, 'sk-1');

    // current 来源：只读 ~/.claude/settings.json
    fs.mkdirSync(process.env.CLAUDE_HOME, { recursive: true });
    fs.writeFileSync(env.claudeSettings, JSON.stringify(src));
    assert.deepStrictEqual(readSourceSettings('current'), src);
    assert.throws(() => readSourceSettings('ghost'), /不存在/);
  } finally {
    env.cleanup();
  }
});

test('copy current：当前配置不存在或损坏时报错', () => {
  const env = setupEnv('clis-copy2-');
  try {
    assert.throws(() => readSourceSettings('current'), /不存在/);
    fs.mkdirSync(process.env.CLAUDE_HOME, { recursive: true });
    fs.writeFileSync(env.claudeSettings, '{bad');
    assert.throws(() => readSourceSettings('current'), /损坏/);
    fs.writeFileSync(env.claudeSettings, '[]');
    assert.throws(() => readSourceSettings('current'), /损坏/);
  } finally {
    env.cleanup();
  }
});

test('overwrite 保存（编辑路径）保留 createdAt 与 lastUsedAt，更新 updatedAt', () => {
  const env = setupEnv('clis-edit-');
  try {
    const { profiles } = env;
    const s1 = buildSettings({ baseUrl: 'https://x', apiKey: 'k1', model: 'm1' });
    profiles.createProfile('p', s1);
    profiles.touchLastUsed('p', '2026-07-20T00:00:00.000Z');
    const before = profiles.readMeta('p');

    const s2 = buildSettings({ baseUrl: 'https://y', apiKey: 'k2', model: 'm2' });
    profiles.createProfile('p', s2, { overwrite: true });
    const after = profiles.readMeta('p');
    assert.strictEqual(after.createdAt, before.createdAt);
    assert.strictEqual(after.lastUsedAt, '2026-07-20T00:00:00.000Z');
    assert.deepStrictEqual(profiles.readSettings('p'), s2);
  } finally {
    env.cleanup();
  }
});

test('profileSummary 密钥脱敏且包含元数据', () => {
  const env = setupEnv('clis-show-');
  try {
    const { profiles } = env;
    const s = buildSettings({ baseUrl: 'https://api.moonshot.cn/anthropic', apiKey: 'sk-bearer-topsecret-9999', model: 'kimi-k2', authType: 'bearer' });
    profiles.createProfile('showme', s);
    profiles.touchLastUsed('showme', '2026-07-25T08:00:00.000Z');

    const sum = profileSummary('showme');
    assert.strictEqual(sum.name, 'showme');
    assert.strictEqual(sum.baseUrl, 'https://api.moonshot.cn/anthropic');
    assert.strictEqual(sum.model, 'kimi-k2');
    assert.ok(sum.maskedKey.includes('****'), '密钥应脱敏');
    assert.ok(!sum.maskedKey.includes('topsecret'), '不得包含完整密钥');
    assert.strictEqual(sum.lastUsedAt, '2026-07-25T08:00:00.000Z');
    assert.ok(sum.createdAt);

    // 损坏配置也能给出摘要（标记 broken）
    fs.writeFileSync(
      path.join(process.env.CLIS_CONFIG_HOME, 'claude', 'profiles', 'showme', 'settings.json'),
      '{bad',
    );
    const broken = profileSummary('showme');
    assert.ok(broken.broken);
  } finally {
    env.cleanup();
  }
});
