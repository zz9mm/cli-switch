'use strict';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * 校验配置档名称：仅允许字母、数字、短横线、下划线。
 * 用于防止路径穿越，并保证目录名安全。
 */
function isValidProfileName(name) {
  return typeof name === 'string' && name.length > 0 && NAME_RE.test(name);
}

function assertValidProfileName(name) {
  if (!isValidProfileName(name)) {
    throw new Error('名称只能包含字母、数字、短横线或下划线');
  }
  return name;
}

// copy 命令的来源保留字：作为配置档名会被劫持（永远解析为「当前生效配置」）。
const RESERVED_NAMES = new Set(['current']);

function isReservedProfileName(name) {
  return RESERVED_NAMES.has(String(name || '').toLowerCase());
}

/**
 * 校验「新建」配置档的名称：在 assertValidProfileName 之上额外拒绝保留字。
 * 仅用于创建入口（create / copy 目标），读取路径不受影响。
 */
function assertValidNewProfileName(name) {
  assertValidProfileName(name);
  if (isReservedProfileName(name)) {
    throw new Error(`名称 "${name}" 是保留字（copy 命令的来源标识），请换一个`);
  }
  return name;
}

/**
 * 校验 API URL：必须是有效的 http:// 或 https:// URL。
 */
function isValidApiUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function assertValidApiUrl(value) {
  if (!isValidApiUrl(value)) {
    throw new Error('API URL 必须是有效的 http:// 或 https:// 地址');
  }
  return value;
}

module.exports = {
  isValidProfileName,
  assertValidProfileName,
  isReservedProfileName,
  assertValidNewProfileName,
  isValidApiUrl,
  assertValidApiUrl,
};
