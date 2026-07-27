'use strict';

const prompts = require('./lib/prompt');
const { claudeMenu, claudeCommand } = require('./claude');
const { codexMenu, codexCommand } = require('./codex');

const USAGE_TOP = `clis — AI 编码工具（Claude Code / Codex）配置档管理器

用法:
  clis                          进入引导菜单
  clis <工具> <子命令> [参数]    非交互执行（工具: claude | codex）
  clis --help | -h | help       显示本帮助
  clis <工具> --help            显示该工具的子命令帮助
`;

const USAGE_CLAUDE = `clis claude <子命令>:
  create <名称>                  创建配置档（引导填写或编辑器编辑 JSON）
  use <名称>                     切换为指定配置档（先备份现有配置）
  use                            交互选择并切换
  current                        显示当前由 clis 应用的配置档
  copy current <新名称>          把当前生效配置存为配置档
  copy <来源> <新名称>           复制既有配置档（非交互不覆盖同名）
  show <名称>                    查看摘要（密钥脱敏）
  edit <名称>                    引导更新或编辑器编辑 JSON
  delete <名称> --yes            非交互删除需显式 --yes 确认
  delete                         交互选择并输入名称二次确认
`;

const USAGE_CODEX = `clis codex <子命令>:
  create <名称>                  创建配置档（引导填写或编辑器编辑 TOML）
  use <名称>                     受管合并写入 config.toml，保留本机状态（先备份）
  use                            交互选择并切换
  current                        显示当前由 clis 应用的配置档
  copy current <新名称>          提取当前配置的受管部分 + auth.json 存为配置档
  copy <来源> <新名称>           复制既有配置档（非交互不覆盖同名）
  show <名称>                    查看摘要（密钥脱敏）
  edit <名称>                    引导更新或编辑器编辑 TOML
  delete <名称> --yes            非交互删除需显式 --yes 确认
  delete                         交互选择并输入名称二次确认
`;

function printHelp(tool) {
  console.log(USAGE_TOP);
  if (tool !== 'codex') console.log(USAGE_CLAUDE);
  if (tool !== 'claude') console.log(USAGE_CODEX);
}

function isHelpFlag(arg) {
  return arg === '--help' || arg === '-h' || arg === 'help';
}

/**
 * 顶层入口。
 * - 无参数：进入引导菜单（选择工具 → 选择操作）。
 * - --help / -h / help：显示用法帮助。
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
  if (isHelpFlag(tool)) {
    printHelp();
    return;
  }
  if (tool === 'claude' || tool === 'codex') {
    if (rest.length > 0 && isHelpFlag(rest[0])) {
      printHelp(tool);
      return;
    }
    if (tool === 'claude') await claudeCommand(rest);
    else await codexCommand(rest);
    return;
  }

  throw new Error(`未知工具: ${tool}（目前支持 claude、codex；--help 查看用法）`);
}

function exitQuietly() {
  console.log('已取消。');
  process.exit(0);
}

module.exports = { main, printHelp };
