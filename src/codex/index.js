'use strict';

const prompts = require('../lib/prompt');
const { runCreate } = require('./create');
const { runDelete } = require('./delete');
const { runUse, runCurrent } = require('./use');
const { runCopy } = require('./copy');
const { runShow, runEdit } = require('./show');

/**
 * Codex 引导菜单（从顶层菜单进入后调用）。
 */
async function codexMenu() {
  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'Codex',
    choices: [
      { title: '创建配置档', value: 'create' },
      { title: '切换配置档', value: 'use' },
      { title: '复制配置档', value: 'copy' },
      { title: '查看/编辑配置档', value: 'show' },
      { title: '删除配置档', value: 'delete' },
    ],
  }, { onCancel: () => { throw new Cancelled(); } }).catch(swallowCancel);

  switch (action) {
    case 'create':
      await runCreate();
      break;
    case 'use':
      await runUse();
      break;
    case 'copy':
      await runCopy();
      break;
    case 'show':
      await runShow();
      break;
    case 'delete':
      await runDelete();
      break;
    default:
      // 取消或未选择。
      break;
  }
}

class Cancelled extends Error {}
function swallowCancel(err) {
  if (err instanceof Cancelled) return {};
  throw err;
}

// 从参数中分离出标志（--xxx）与位置参数。
function parseArgs(args) {
  const flags = new Set();
  const positional = [];
  for (const a of args) {
    if (a.startsWith('--')) flags.add(a.slice(2));
    else positional.push(a);
  }
  return { flags, positional };
}

/**
 * Codex 非交互子命令：clis codex <sub> [args...]
 */
async function codexCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create':
      await runCreate(rest[0]);
      break;
    case 'use':
      await runUse(rest[0]);
      break;
    case 'current':
      runCurrent();
      break;
    case 'copy': {
      const { positional } = parseArgs(rest);
      await runCopy(positional[0], positional[1]);
      break;
    }
    case 'show':
      await runShow(rest[0]);
      break;
    case 'edit':
      await runEdit(rest[0]);
      break;
    case 'delete': {
      const { flags, positional } = parseArgs(rest);
      await runDelete(positional[0], { yes: flags.has('yes') });
      break;
    }
    case undefined:
      await codexMenu();
      break;
    default:
      throw new Error(`未知的 codex 子命令: ${sub}（支持 create、use、current、copy、show、edit、delete）`);
  }
}

module.exports = { codexMenu, codexCommand };
