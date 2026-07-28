'use strict';

/** 解析子命令参数，并拒绝未知选项或不符合数量约束的位置参数。 */
function parseCommandArgs(args, { allowedFlags = [], positionalCounts, usage }) {
  const flags = new Set();
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('-')) {
      const flag = arg.startsWith('--') ? arg.slice(2) : '';
      if (!flag || !allowedFlags.includes(flag)) {
        throw new Error(`未知选项: ${arg}（用法: ${usage}）`);
      }
      flags.add(flag);
    } else {
      positional.push(arg);
    }
  }
  if (!positionalCounts.includes(positional.length)) {
    throw new Error(`用法: ${usage}`);
  }
  return { flags, positional };
}

module.exports = { parseCommandArgs };
