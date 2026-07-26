'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mergeConfig, extractManagedToml, assertValidManagedToml, summarizeToml, splitToml, isManagedSection } = require('../src/lib/toml');
const { assertValidNewProfileName } = require('../src/lib/validate');
const { buildToml } = require('../src/codex/create');
const { applyProfile } = require('../src/codex/use');
const { readSourceProfile } = require('../src/codex/copy');
const { profileSummary } = require('../src/codex/show');

// 建立隔离的 clis 配置根 + Codex home；返回清理函数。
function setupEnv(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.CLIS_CONFIG_HOME = path.join(tmp, 'clis-config');
  process.env.CODEX_HOME = path.join(tmp, 'codex-home');
  const store = require('../src/codex/store');
  const { codexState } = require('../src/lib/state');
  return {
    tmp,
    store,
    codexState,
    codexConfig: path.join(process.env.CODEX_HOME, 'config.toml'),
    codexAuth: path.join(process.env.CODEX_HOME, 'auth.json'),
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
      delete process.env.CLIS_CONFIG_HOME;
      delete process.env.CODEX_HOME;
    },
  };
}

// 接近真实 ~/.codex/config.toml 的形状：受管内容 + 本机状态混合。
const EXISTING_CONFIG = `model_provider = "custom"
model = "old-model"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = "Sub2API"
base_url = "https://old.example.com"
wire_api = "responses"
requires_openai_auth = true

[projects.'d:\\code\\2026']
trust_level = "trusted"

[tui.model_availability_nux]
"gpt-5.5" = 4

[windows]
sandbox = "elevated"
`;

const NEW_PROFILE_TOML = buildToml({
  provider: 'newapi',
  baseUrl: 'https://new.example.com',
  wireApi: 'responses',
  model: 'new-model',
  reasoningEffort: 'medium',
});

test('mergeConfig 替换受管内容，逐字保留本机 section', () => {
  const merged = mergeConfig(EXISTING_CONFIG, NEW_PROFILE_TOML);

  // 受管内容被替换
  assert.match(merged, /model = "new-model"/);
  assert.match(merged, /model_reasoning_effort = "medium"/);
  assert.match(merged, /\[model_providers\.newapi\]/);
  assert.match(merged, /base_url = "https:\/\/new\.example\.com"/);
  assert.doesNotMatch(merged, /old-model/);
  assert.doesNotMatch(merged, /old\.example\.com/);
  assert.doesNotMatch(merged, /\[model_providers\.custom\]/);

  // 本机状态逐字保留
  assert.ok(merged.includes("[projects.'d:\\code\\2026']"));
  assert.match(merged, /trust_level = "trusted"/);
  assert.match(merged, /\[tui\.model_availability_nux\]/);
  assert.match(merged, /\[windows\]/);
  assert.match(merged, /sandbox = "elevated"/);

  // 非受管顶层键保留
  assert.match(merged, /disable_response_storage = true/);
});

test('mergeConfig 现有配置为空时直接采用配置档内容', () => {
  const merged = mergeConfig('', NEW_PROFILE_TOML);
  assert.match(merged, /model = "new-model"/);
  assert.match(merged, /\[model_providers\.newapi\]/);
});

test('mergeConfig 配置档不写 reasoning effort 时清除旧值', () => {
  const noEffort = buildToml({
    provider: 'p', baseUrl: 'https://x.com', wireApi: 'chat', model: 'm', reasoningEffort: '',
  });
  const merged = mergeConfig(EXISTING_CONFIG, noEffort);
  assert.doesNotMatch(merged, /model_reasoning_effort/);
});

test('extractManagedToml 只提取受管部分', () => {
  const managed = extractManagedToml(EXISTING_CONFIG);
  assert.match(managed, /model = "old-model"/);
  assert.match(managed, /\[model_providers\.custom\]/);
  assert.doesNotMatch(managed, /projects/);
  assert.doesNotMatch(managed, /tui/);
  assert.doesNotMatch(managed, /windows/);
  assert.doesNotMatch(managed, /disable_response_storage/);
});

test('assertValidManagedToml 拒绝本机状态内容', () => {
  assert.throws(() => assertValidManagedToml('[projects.\'d:\\x\']\ntrust_level = "trusted"\n'), /不允许的 section/);
  assert.throws(() => assertValidManagedToml('disable_response_storage = true\n'), /不允许的顶层键/);
  assert.throws(() => assertValidManagedToml('   \n'), /为空/);
  // 合法片段通过
  assertValidManagedToml(NEW_PROFILE_TOML);
});

test('buildToml 与 summarizeToml 往返一致', () => {
  const s = summarizeToml(NEW_PROFILE_TOML);
  assert.strictEqual(s.model, 'new-model');
  assert.strictEqual(s.provider, 'newapi');
  assert.strictEqual(s.baseUrl, 'https://new.example.com');
  assert.strictEqual(s.wireApi, 'responses');
  assert.strictEqual(s.reasoningEffort, 'medium');
});

test('codex store 创建、读取、元数据、删除', () => {
  const env = setupEnv('clis-test-codex-store-');
  try {
    env.store.createProfile('work', { toml: NEW_PROFILE_TOML, auth: { OPENAI_API_KEY: 'sk-test-123456' } });
    assert.deepStrictEqual(env.store.listProfiles(), ['work']);
    assert.strictEqual(env.store.readConfigToml('work'), NEW_PROFILE_TOML);
    assert.strictEqual(env.store.readAuth('work').OPENAI_API_KEY, 'sk-test-123456');
    const meta = env.store.readMeta('work');
    assert.ok(meta.createdAt && meta.updatedAt);

    env.store.touchLastUsed('work');
    assert.ok(env.store.readMeta('work').lastUsedAt);

    // 重名拒绝
    assert.throws(() => env.store.createProfile('work', { toml: 'x' }), /已存在/);

    env.store.deleteProfile('work');
    assert.deepStrictEqual(env.store.listProfiles(), []);
  } finally {
    env.cleanup();
  }
});

test('codex store 无 auth 的配置档 readAuth 返回 null', () => {
  const env = setupEnv('clis-test-codex-noauth-');
  try {
    env.store.createProfile('nokey', { toml: NEW_PROFILE_TOML, auth: null });
    assert.strictEqual(env.store.readAuth('nokey'), null);
    assert.ok(env.store.profileExists('nokey'));
  } finally {
    env.cleanup();
  }
});

test('applyProfile 合并保留本机状态、写入 auth、备份旧配置', () => {
  const env = setupEnv('clis-test-codex-apply-');
  try {
    // 现有生效配置
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(env.codexConfig, EXISTING_CONFIG);
    fs.writeFileSync(env.codexAuth, JSON.stringify({ OPENAI_API_KEY: 'old-key' }));

    env.store.createProfile('work', { toml: NEW_PROFILE_TOML, auth: { OPENAI_API_KEY: 'new-key-123456' } });
    const { backup } = applyProfile('work');

    const merged = fs.readFileSync(env.codexConfig, 'utf8');
    assert.match(merged, /model = "new-model"/);
    assert.match(merged, /trust_level = "trusted"/); // 本机状态保留
    assert.strictEqual(JSON.parse(fs.readFileSync(env.codexAuth, 'utf8')).OPENAI_API_KEY, 'new-key-123456');

    assert.ok(backup.configPath && fs.existsSync(backup.configPath));
    assert.ok(backup.authPath && fs.existsSync(backup.authPath));

    assert.strictEqual(env.codexState.readCurrentProfile(), 'work');
    assert.ok(env.store.readMeta('work').lastUsedAt);
  } finally {
    env.cleanup();
  }
});

test('applyProfile 拒绝被手工改坏的配置档（含本机状态 section）', () => {
  const env = setupEnv('clis-test-codex-bad-');
  try {
    env.store.createProfile('bad', { toml: NEW_PROFILE_TOML, auth: null });
    // 手工往配置档里塞 [projects]（越界内容）
    const cfg = path.join(process.env.CLIS_CONFIG_HOME, 'codex', 'profiles', 'bad', 'config.toml');
    fs.writeFileSync(cfg, '[projects.\'d:\\x\']\ntrust_level = "trusted"\n');
    assert.throws(() => applyProfile('bad'), /不允许的 section/);
    // 未写入任何生效配置
    assert.ok(!fs.existsSync(env.codexConfig));
  } finally {
    env.cleanup();
  }
});

test('copy current：提取受管 TOML 与 auth，目标独立', () => {
  const env = setupEnv('clis-test-codex-copy-');
  try {
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(env.codexConfig, EXISTING_CONFIG);
    fs.writeFileSync(env.codexAuth, JSON.stringify({ OPENAI_API_KEY: 'cur-key' }));

    const profile = readSourceProfile('current');
    assert.match(profile.toml, /model = "old-model"/);
    assert.doesNotMatch(profile.toml, /trust_level/);
    assert.strictEqual(profile.auth.OPENAI_API_KEY, 'cur-key');

    env.store.createProfile('copied', profile);
    // 修改来源不影响已复制内容
    fs.writeFileSync(env.codexConfig, 'model = "changed"\n');
    assert.match(env.store.readConfigToml('copied'), /old-model/);
  } finally {
    env.cleanup();
  }
});

test('profileSummary 密钥脱敏且包含元数据', () => {
  const env = setupEnv('clis-test-codex-summary-');
  try {
    env.store.createProfile('work', { toml: NEW_PROFILE_TOML, auth: { OPENAI_API_KEY: 'sk-secret-abcdef' } });
    const s = profileSummary('work');
    assert.strictEqual(s.model, 'new-model');
    assert.strictEqual(s.baseUrl, 'https://new.example.com');
    assert.ok(s.maskedKey.includes('****'));
    assert.ok(!s.maskedKey.includes('secret-ab'));
    assert.ok(s.createdAt);
  } finally {
    env.cleanup();
  }
});

test('overwrite 为不管理密钥时清除残留 auth.json', () => {
  const env = setupEnv('clis-test-codex-stale-');
  try {
    env.store.createProfile('p', { toml: NEW_PROFILE_TOML, auth: { OPENAI_API_KEY: 'sk-old' } });
    // 用不管理密钥的内容覆盖（copy 覆盖路径的等价调用）
    env.store.createProfile('p', { toml: NEW_PROFILE_TOML, auth: null }, { overwrite: true });
    assert.strictEqual(env.store.readAuth('p'), null);
    assert.ok(!fs.existsSync(path.join(process.env.CLIS_CONFIG_HOME, 'codex', 'profiles', 'p', 'auth.json')));
  } finally {
    env.cleanup();
  }
});

test('buildToml 保留 requiresOpenaiAuth=false，默认仍为 true', () => {
  const off = buildToml({
    provider: 'p', baseUrl: 'https://x.com', wireApi: 'chat', model: 'm', reasoningEffort: '', requiresOpenaiAuth: false,
  });
  assert.match(off, /requires_openai_auth = false/);
  const def = buildToml({
    provider: 'p', baseUrl: 'https://x.com', wireApi: 'chat', model: 'm', reasoningEffort: '',
  });
  assert.match(def, /requires_openai_auth = true/);
});

test('保留字 current 不能作为新配置档名', () => {
  assert.throws(() => assertValidNewProfileName('current'), /保留字/);
  assert.throws(() => assertValidNewProfileName('Current'), /保留字/);
  assert.strictEqual(assertValidNewProfileName('work'), 'work');
});

test('splitToml 识别带行尾注释的 section 头', () => {
  const text = 'model = "gpt-5"\n\n[model_providers.x] # 我的 provider\nbase_url = "https://a"\n';
  const { sections, preambleKeys } = splitToml(text);
  assert.strictEqual(sections.length, 1);
  assert.ok(isManagedSection(sections[0].name));
  assert.deepStrictEqual(preambleKeys, ['model']);

  // 带注释的合法片段能通过受管校验
  assertValidManagedToml(text);

  // 现有配置的旧 provider 带注释时也能被整体替换，不残留孤儿键
  const merged = mergeConfig('[model_providers.old] # c\nbase_url = "https://old"\n', NEW_PROFILE_TOML);
  assert.doesNotMatch(merged, /https:\/\/old/);
  assert.match(merged, /\[model_providers\.newapi\]/);
});

test('applyProfile 切到不管理密钥的配置档时警告残留 auth.json', () => {
  const env = setupEnv('clis-test-codex-warn-');
  try {
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(env.codexConfig, EXISTING_CONFIG);
    fs.writeFileSync(env.codexAuth, JSON.stringify({ OPENAI_API_KEY: 'old-key' }));
    env.store.createProfile('nokey', { toml: NEW_PROFILE_TOML, auth: null });

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      applyProfile('nokey');
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some((l) => l.includes('不管理密钥')));
    // 行为不变：auth.json 保留，仅提示
    assert.strictEqual(JSON.parse(fs.readFileSync(env.codexAuth, 'utf8')).OPENAI_API_KEY, 'old-key');
  } finally {
    env.cleanup();
  }
});
