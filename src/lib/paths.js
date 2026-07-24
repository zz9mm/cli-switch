'use strict';

const os = require('os');
const path = require('path');

/**
 * 集中管理 clis 使用的文件系统路径。
 *
 * 支持通过环境变量覆盖，便于测试与自定义：
 * - CLIS_CONFIG_HOME 覆盖 clis 自身的配置根目录。
 * - CLAUDE_HOME 覆盖 Claude Code 的 ~/.claude 目录。
 */
function configHome() {
  if (process.env.CLIS_CONFIG_HOME) return process.env.CLIS_CONFIG_HOME;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'clis');
}

function claudeHome() {
  if (process.env.CLAUDE_HOME) return process.env.CLAUDE_HOME;
  return path.join(os.homedir(), '.claude');
}

// clis 管理的 Claude Code 配置档根目录。
function claudeProfilesDir() {
  return path.join(configHome(), 'claude', 'profiles');
}

// 切换配置档时备份 Claude Code 现有配置的目录。
function claudeBackupsDir() {
  return path.join(configHome(), 'claude', 'backups');
}

// 记录当前由 clis 应用的配置档状态文件。
function claudeStateFile() {
  return path.join(configHome(), 'claude', 'state.json');
}

// 单个配置档目录。
function profileDir(name) {
  return path.join(claudeProfilesDir(), name);
}

// 单个配置档的 settings.json（Claude Code 可直接读取的格式）。
function profileSettingsFile(name) {
  return path.join(profileDir(name), 'settings.json');
}

// 单个配置档的 clis 元数据文件（名称、创建/使用时间等）。
function profileMetaFile(name) {
  return path.join(profileDir(name), 'meta.json');
}

// Claude Code 当前生效的 settings.json。
function claudeSettingsFile() {
  return path.join(claudeHome(), 'settings.json');
}

module.exports = {
  configHome,
  claudeHome,
  claudeProfilesDir,
  claudeBackupsDir,
  claudeStateFile,
  profileDir,
  profileSettingsFile,
  profileMetaFile,
  claudeSettingsFile,
};
