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
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return backupFile(paths.claudeSettingsFile(), paths.claudeBackupsDir(), 'settings', stamp);
}

// 单个文件的时间戳备份；源不存在时返回 null。
function backupFile(src, dir, baseName, stamp) {
  let raw;
  try {
    raw = fs.readFileSync(src);
  } catch {
    return null;
  }
  ensureDir(dir, 0o700);
  let dest = path.join(dir, `${baseName}-${stamp}${path.extname(src)}`);
  for (let i = 1; fs.existsSync(dest); i += 1) {
    dest = path.join(dir, `${baseName}-${stamp}-${i}${path.extname(src)}`);
  }
  fs.writeFileSync(dest, raw, { mode: 0o600 });
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    // 忽略不支持 chmod 的平台。
  }
  return dest;
}

/**
 * 切换配置档前备份 Codex 当前生效的 config.toml 与 auth.json。
 * 两个文件共用同一时间戳，便于成对恢复。
 *
 * @returns {{ configPath: string|null, authPath: string|null }}
 */
function backupCodexConfig(now = new Date()) {
  const dir = paths.codexBackupsDir();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    configPath: backupFile(paths.codexConfigFile(), dir, 'config', stamp),
    authPath: backupFile(paths.codexAuthFile(), dir, 'auth', stamp),
  };
}

module.exports = { backupClaudeSettings, backupCodexConfig };
