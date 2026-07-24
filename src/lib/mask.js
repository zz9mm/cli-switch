'use strict';

/**
 * 对密钥类字符串做脱敏：只保留前后少量字符，中间用星号代替。
 * 短字符串直接全部遮蔽，避免泄露长度信息之外的内容。
 */
function maskSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return '';
  if (secret.length <= 8) return '*'.repeat(secret.length);
  const head = secret.slice(0, 4);
  const tail = secret.slice(-4);
  return `${head}${'*'.repeat(Math.max(4, secret.length - 8))}${tail}`;
}

/**
 * 返回一份用于展示的 settings 副本，其中的 API Key 已脱敏。
 * 不修改传入对象。
 */
// 需要脱敏的敏感环境变量名。
const SECRET_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

function maskSettingsForDisplay(settings) {
  const clone = JSON.parse(JSON.stringify(settings || {}));
  const env = clone.env;
  if (env && typeof env === 'object') {
    for (const k of SECRET_ENV_KEYS) {
      if (typeof env[k] === 'string') env[k] = maskSecret(env[k]);
    }
  }
  return clone;
}

module.exports = { maskSecret, maskSettingsForDisplay };
