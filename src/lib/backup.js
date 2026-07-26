'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { ensureDir } = require('./fsutil');

/**
 * 切换配置档前备份 Claude Code 当前生效的 settings.json。
 *
 * 备份保存于 <configHome>/claude/backups/settings-<时间戳>.json（0600），
 * 文件名含创建时间以便恢复。同毫秒冲突时追加序号。
 *
 * @returns {string|null} 备份文件路径；当前没有生效配置时返回 null。
 */
function backupClaudeSettings(now = new Date()) {
  const src = paths.claudeSettingsFile();
  let raw;
  try {
    raw = fs.readFileSync(src);
  } catch {
    return null; // 没有可备份的现有配置
  }

  const dir = paths.claudeBackupsDir();
  ensureDir(dir, 0o700);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let dest = path.join(dir, `settings-${stamp}.json`);
  for (let i = 1; fs.existsSync(dest); i += 1) {
    dest = path.join(dir, `settings-${stamp}-${i}.json`);
  }
  fs.writeFileSync(dest, raw, { mode: 0o600 });
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    // 忽略不支持 chmod 的平台。
  }
  return dest;
}

module.exports = { backupClaudeSettings };
