'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 以指定权限确保目录存在（递归创建）。
 * 对已存在目录也会尝试收紧权限。
 */
function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try {
    fs.chmodSync(dir, mode);
  } catch {
    // 某些平台（如 Windows）不支持 chmod，忽略。
  }
}

/**
 * 原子写入文件：先写临时文件，再 rename 覆盖目标。
 * 失败时清理临时文件，绝不留下截断文件。
 */
function atomicWriteFile(filePath, data, mode = 0o600) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filePath);
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // 忽略不支持 chmod 的平台。
    }
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

module.exports = { ensureDir, atomicWriteFile };
