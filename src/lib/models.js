'use strict';

/**
 * 从 Anthropic 兼容端点动态拉取可用模型列表。
 *
 * 请求 `{base}/v1/models`，兼容两种鉴权与两种常见返回结构：
 *   - 鉴权：x-api-key(+anthropic-version) 或 Authorization: Bearer。
 *   - 返回：{ data: [{ id }] }（Anthropic / OpenAI 风格）或 { models: [{ id }] }。
 *
 * 失败时抛出「不含密钥」的错误，调用方可回退为手动输入模型名。
 */

// 拼接 base 与端点路径：去掉 base 尾部斜杠后再接 /v1/models，
// 与 Claude Code 拼 /v1/messages 的方式一致。
function modelsUrl(baseUrl) {
  const trimmed = String(baseUrl).replace(/\/+$/, '');
  return `${trimmed}/v1/models`;
}

function buildHeaders(authType, key) {
  if (authType === 'bearer') {
    return { Authorization: `Bearer ${key}` };
  }
  // 默认 x-api-key（官方 Anthropic）
  return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
}

// 从多种返回结构中提取模型 id 列表。
function extractModelIds(payload) {
  const arr = (payload && (payload.data || payload.models)) || [];
  if (!Array.isArray(arr)) return [];
  const ids = arr
    .map((m) => (typeof m === 'string' ? m : m && (m.id || m.name)))
    .filter((id) => typeof id === 'string' && id.length > 0);
  // 去重并保持顺序
  return [...new Set(ids)];
}

/**
 * @returns {Promise<string[]>} 模型 id 列表（可能为空数组）。
 * @throws 当网络失败、超时或 HTTP 非 2xx 时抛错（错误信息不含密钥）。
 */
async function fetchModels(baseUrl, { authType = 'api_key', key, timeoutMs = 10000 } = {}) {
  const url = modelsUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(authType, key),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs}ms）`);
    }
    throw new Error(`无法连接端点: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    // 不读取/输出响应体，避免回显敏感信息；仅暴露状态码。
    throw new Error(`端点返回 HTTP ${res.status}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('端点返回的不是有效 JSON');
  }
  return extractModelIds(payload);
}

module.exports = { fetchModels, modelsUrl, extractModelIds };
