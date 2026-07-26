'use strict';

const prompts = require('./lib/prompt');
const { claudeMenu, claudeCommand } = require('./claude');
const { codexMenu, codexCommand } = require('./codex');

/**
 * 顶层入口。
 * - 无参数：进入引导菜单（选择工具 → 选择操作）。
 * - clis claude|codex ...：进入对应工具的子命令。
 */
async function main(argv) {
  if (argv.length === 0) {
    const { tool } = await prompts({
      type: 'select',
      name: 'tool',
      message: '选择要管理的工具',
      choices: [
        { title: 'Claude Code', value: 'claude' },
        { title: 'Codex', value: 'codex' },
      ],
    }, { onCancel: exitQuietly });
    if (tool === 'codex') await codexMenu();
    else await claudeMenu();
    return;
  }

  const [tool, ...rest] = argv;
  if (tool === 'claude') {
    await claudeCommand(rest);
    return;
  }
  if (tool === 'codex') {
    await codexCommand(rest);
    return;
  }

  throw new Error(`未知工具: ${tool}（目前支持 claude、codex）`);
}

function exitQuietly() {
  console.log('已取消。');
  process.exit(0);
}

module.exports = { main };
