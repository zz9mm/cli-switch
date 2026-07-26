'use strict';

const fs = require('fs');
const paths = require('./paths');
const { ensureDir, atomicWriteFile } = require('./fsutil');

/**
 * 当前配置档状态（按工具隔离）。
 *
 * 记录「由 clis 应用为当前生效」的配置档名称与应用时间。
 * 仅存名称与时间，绝不记录密钥或配置内容。
 * 文件：<configHome>/<tool>/state.json（0600）。
 */

function makeState(stateFile) {
  function readState() {
    try {
      return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
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
    ensureDir(require('path').dirname(stateFile()), 0o700);
    atomicWriteFile(stateFile(), JSON.stringify(state, null, 2) + '\n', 0o600);
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

  return { readState, readCurrentProfile, writeState, setCurrentProfile, clearCurrentIfMatches };
}

const claudeState = makeState(paths.claudeStateFile);
const codexState = makeState(paths.codexStateFile);

module.exports = {
  ...claudeState,
  codexState,
};
