'use strict';

const fs = require('fs');
const paths = require('./paths');
const { ensureDir, atomicWriteFile } = require('./fsutil');

/**
 * 当前配置档状态。
 *
 * 记录「由 clis 应用为当前生效」的配置档名称与应用时间。
 * 仅存名称与时间，绝不记录密钥或配置内容。
 * 文件：<configHome>/claude/state.json（0600）。
 */

function readState() {
  try {
    return JSON.parse(fs.readFileSync(paths.claudeStateFile(), 'utf8'));
  } catch {
    return {};
  }
}

// 返回当前配置档名称，若无则 null。
function readCurrentProfile() {
  const s = readState();
  return typeof s.currentProfile === 'string' ? s.currentProfile : null;
}

function writeState(state) {
  ensureDir(require('path').dirname(paths.claudeStateFile()), 0o700);
  atomicWriteFile(paths.claudeStateFile(), JSON.stringify(state, null, 2) + '\n', 0o600);
}

function setCurrentProfile(name, appliedAt) {
  writeState({ currentProfile: name, appliedAt: appliedAt || new Date().toISOString() });
}

// 若当前配置档等于 name，则清除当前状态；返回是否发生了清除。
function clearCurrentIfMatches(name) {
  if (readCurrentProfile() === name) {
    writeState({ currentProfile: null, appliedAt: null });
    return true;
  }
  return false;
}

module.exports = {
  readState,
  readCurrentProfile,
  writeState,
  setCurrentProfile,
  clearCurrentIfMatches,
};
