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
  isValidApiUrl,
  assertValidApiUrl,
};
