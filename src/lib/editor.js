'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * 在 $VISUAL / $EDITOR 中编辑一段初始内容，返回编辑后的文本。
 *
 * 使用临时文件；调用方负责对返回文本做 JSON 校验。
 * 若编辑器非正常退出（非 0 退出码），抛错，调用方应保留原文件。
 */
function editInEditor(initialContent, { suffix = '.json' } = {}) {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    throw new Error('未设置 $VISUAL 或 $EDITOR，无法打开编辑器');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clis-'));
  const tmpFile = path.join(tmpDir, `profile${suffix}`);
  try {
    fs.writeFileSync(tmpFile, initialContent, { mode: 0o600 });
    // 通过 shell 解析编辑器命令，以支持带参数的 EDITOR（如 "code -w"）。
    const result = spawnSync(`${editor} "${tmpFile}"`, {
      stdio: 'inherit',
      shell: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`编辑器异常退出（退出码 ${result.status}）`);
    }
    return fs.readFileSync(tmpFile, 'utf8');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { editInEditor };
