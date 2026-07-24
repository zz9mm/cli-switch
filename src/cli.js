'use strict';

const prompts = require('./lib/prompt');
const { claudeMenu, claudeCommand } = require('./claude');

/**
 * 顶层入口。
 * - 无参数：进入引导菜单（选择工具 → 选择操作）。
 * - clis claude ...：进入 Claude Code 子命令。
 */
async function main(argv) {
  if (argv.length === 0) {
    const { tool } = await prompts({
      type: 'select',
      name: 'tool',
      message: '选择要管理的工具',
      choices: [{ title: 'Claude Code', value: 'claude' }],
    }, { onCancel: exitQuietly });
    await claudeMenu();
    return;
  }

  const [tool, ...rest] = argv;
  if (tool === 'claude') {
    await claudeCommand(rest);
    return;
  }

  throw new Error(`未知工具: ${tool}（目前仅支持 claude）`);
}

function exitQuietly() {
  console.log('已取消。');
  process.exit(0);
}

module.exports = { main };
