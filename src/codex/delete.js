'use strict';

const prompts = require('../lib/prompt');
const store = require('./store');
const { codexState } = require('../lib/state');
const { assertValidProfileName } = require('../lib/validate');
const { summarizeToml } = require('../lib/toml');

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

// 读取配置档摘要用于二次核对（名称、模型、API URL）；不输出密钥。
function summaryLine(name) {
  try {
    const s = summarizeToml(store.readConfigToml(name));
    return `  名称: ${name}\n  模型: ${s.model || '(未设置)'}\n  API URL: ${s.baseUrl || '(未知)'}`;
  } catch {
    return `  名称: ${name}\n  (配置无法解析，仍可删除)`;
  }
}

// 若删除的是当前配置档，说明删除不会改动 Codex 已生效的配置。
function noteIfCurrent(name) {
  if (codexState.readCurrentProfile() === name) {
    console.log('注意：这是当前由 clis 应用的配置档。');
    console.log('删除它不会修改 Codex 已写入的 ~/.codex/config.toml 与 auth.json，仅移除该配置档本身。');
    return true;
  }
  return false;
}

// 实际删除并清理状态。
function performDelete(name) {
  store.deleteProfile(name);
  const cleared = codexState.clearCurrentIfMatches(name);
  console.log(`已删除配置档: ${name}`);
  if (cleared) console.log('（已清除当前配置档状态记录）');
}

/**
 * 删除配置档主流程。
 * @param {string|undefined} presetName 非交互入口传入的名称。
 * @param {{ yes?: boolean }} opts 非交互确认开关。
 */
async function runDelete(presetName, { yes = false } = {}) {
  try {
    // —— 非交互：clis codex delete <名称> [--yes] ——
    if (presetName) {
      assertValidProfileName(presetName);
      if (!store.profileExists(presetName)) {
        throw new Error(`配置档不存在: ${presetName}`);
      }
      console.log('将删除以下配置档：');
      console.log(summaryLine(presetName));
      noteIfCurrent(presetName);
      if (!yes) {
        console.log('未删除。非交互模式需追加 --yes 以确认删除。');
        process.exitCode = 1; // 未执行删除，向脚本返回非零
        return;
      }
      performDelete(presetName);
      return;
    }

    // —— 交互：列表选择 ——
    const names = store.listProfiles();
    if (names.length === 0) {
      console.log('没有可删除的配置档。');
      return;
    }

    const { name } = await prompts({
      type: 'select',
      name: 'name',
      message: '选择要删除的配置档',
      choices: names.map((n) => ({ title: n, value: n })),
    }, { onCancel });

    console.log('将删除以下配置档：');
    console.log(summaryLine(name));
    noteIfCurrent(name);

    // 要求输入配置档名称二次确认。
    const { typed } = await prompts({
      type: 'text',
      name: 'typed',
      message: `输入配置档名称「${name}」以确认删除`,
    }, { onCancel });

    if (typed !== name) {
      console.log('名称不匹配，已取消，未删除任何配置档。');
      return;
    }

    performDelete(name);
  } catch (err) {
    if (err instanceof CancelError || err.cancelled) {
      console.log('已取消，未删除任何配置档。');
      return;
    }
    throw err;
  }
}

module.exports = { runDelete };
