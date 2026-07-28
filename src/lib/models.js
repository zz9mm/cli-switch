'use strict';

const http = require('http');
const https = require('https');

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
  const payload = await requestJson(url, buildHeaders(authType, key), timeoutMs);
  return extractModelIds(payload);
}

// 使用 Node 内置 HTTP 客户端，避免依赖 Node 18 才默认提供的全局 fetch。
function requestJson(url, headers, timeoutMs, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(parsed, { headers }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft === 0) {
          reject(new Error('端点重定向次数过多'));
          return;
        }
        const next = new URL(res.headers.location, parsed);
        if (next.host !== parsed.host) {
          reject(new Error('端点重定向到不同主机，已拒绝发送鉴权信息'));
          return;
        }
        requestJson(next.toString(), headers, timeoutMs, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`端点返回 HTTP ${status}`));
        return;
      }

      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          req.destroy(new Error('端点响应过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('端点返回的不是有效 JSON'));
        }
      });
      res.on('error', (err) => reject(new Error(`读取端点响应失败: ${err.message}`)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    req.on('error', (err) => {
      if (/^(请求超时|端点响应过大)/.test(err.message)) reject(err);
      else reject(new Error(`无法连接端点: ${err.message}`));
    });
  });
}

module.exports = { fetchModels, modelsUrl, extractModelIds };
