'use strict';

const prompts = require('../lib/prompt');
const { runCreate } = require('./create');
const { runDelete } = require('./delete');
const { runUse, runCurrent } = require('./use');
const { runCopy } = require('./copy');
const { runShow, runEdit } = require('./show');
const { parseCommandArgs } = require('../lib/args');

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

/**
 * Codex 非交互子命令：clis codex <sub> [args...]
 */
async function codexCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create': {
      const { positional } = parseCommandArgs(rest, { positionalCounts: [0, 1], usage: 'clis codex create [名称]' });
      await runCreate(positional[0]);
      break;
    }
    case 'use': {
      const { positional } = parseCommandArgs(rest, { positionalCounts: [0, 1], usage: 'clis codex use [名称]' });
      await runUse(positional[0]);
      break;
    }
    case 'current':
      parseCommandArgs(rest, { positionalCounts: [0], usage: 'clis codex current' });
      runCurrent();
      break;
    case 'copy': {
      const { positional } = parseCommandArgs(rest, {
        positionalCounts: [0, 2],
        usage: 'clis codex copy [<来源名称|current> <新名称>]',
      });
      await runCopy(positional[0], positional[1]);
      break;
    }
    case 'show': {
      const { positional } = parseCommandArgs(rest, { positionalCounts: [0, 1], usage: 'clis codex show [名称]' });
      await runShow(positional[0]);
      break;
    }
    case 'edit': {
      const { positional } = parseCommandArgs(rest, { positionalCounts: [0, 1], usage: 'clis codex edit [名称]' });
      await runEdit(positional[0]);
      break;
    }
    case 'delete': {
      const { flags, positional } = parseCommandArgs(rest, {
        allowedFlags: ['yes'],
        positionalCounts: [0, 1],
        usage: 'clis codex delete [名称] [--yes]',
      });
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
