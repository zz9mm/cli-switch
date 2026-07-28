'use strict';

/**
 * 行级 TOML 子集处理器（零依赖）。
 *
 * 不做完整 TOML 解析：只按行切分出「顶层键值（preamble）」与「section」，
 * 用于 codex config.toml 的受管合并——替换 clis 管理的顶层键与
 * [model_providers.*] section，逐字保留其余内容（[projects.*] 信任记录、
 * [tui.*]、[windows] 等本机状态）。
 *
 * 受管范围（切换配置档时会被配置档内容替换的部分）：
 *   - 顶层键：MANAGED_TOP_KEYS
 *   - section：[model_providers.*]（含引号写法 [model_providers.'x']）
 */

const MANAGED_TOP_KEYS = ['model', 'model_provider', 'model_reasoning_effort', 'model_verbosity'];
const MANAGED_SECTION_PREFIX = 'model_providers.';

// 规范化 section 名：去掉引号与空白，便于匹配 [model_providers.'x'] 等写法。
function normalizeSectionName(name) {
  return name.replace(/['"\s]/g, '');
}

const KEY_RE = /^\s*([A-Za-z0-9_.-]+)\s*=/;
// section 头允许行尾注释（如 [model_providers.x] # 注释），否则整段会被误判为 preamble。
const HEADER_RE = /^\s*(?:\[\[\s*([^\[\]]+?)\s*\]\]|\[\s*([^\[\]]+?)\s*\])\s*(?:#.*)?$/;

/**
 * 把 TOML 文本切分为 preamble（首个 section 之前的顶层内容）与 sections。
 * 每段保留原始行，不做值解析。
 *
 * @returns {{ preambleKeys: string[], preambleLines: string[], sections: Array<{name: string, lines: string[]}> }}
 */
function splitToml(text) {
  const lines = String(text || '').split('\n');
  const preambleLines = [];
  const preambleKeys = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const header = line.match(HEADER_RE);
    if (header) {
      current = { name: (header[1] || header[2]).trim(), lines: [line], array: Boolean(header[1]) };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    preambleLines.push(line);
    const kv = line.match(KEY_RE);
    if (kv) preambleKeys.push(kv[1]);
  }
  return { preambleKeys, preambleLines, sections };
}

// 该 section 是否属于 clis 受管范围（[model_providers.*]）。
function isManagedSection(name) {
  const normalized = normalizeSectionName(name);
  return normalized.startsWith(MANAGED_SECTION_PREFIX)
    && normalized.length > MANAGED_SECTION_PREFIX.length;
}

// 去掉尾部空白行，避免拼接时出现连续空行。
function trimTrailingBlank(lines) {
  const out = lines.slice();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * 合并现有 config.toml 与配置档的受管片段：
 *   - 现有 preamble 中的受管键（MANAGED_TOP_KEYS）整体移除；
 *   - 现有 [model_providers.*] section 整体移除；
 *   - 配置档的 preamble 键值与 providers section 写入；
 *   - 其余内容（本机状态 section、注释、非受管顶层键）逐字保留。
 *
 * @param {string} existingText 现有 config.toml（可为空字符串）。
 * @param {string} managedText 配置档的受管 TOML 片段。
 * @returns {string} 合并后的 TOML 文本（以换行结尾）。
 */
function mergeConfig(existingText, managedText) {
  const existing = splitToml(existingText);
  const managed = splitToml(managedText);

  const keptPreamble = existing.preambleLines.filter((line) => {
    const kv = line.match(KEY_RE);
    return !kv || !MANAGED_TOP_KEYS.includes(kv[1]);
  });
  const keptSections = existing.sections.filter((s) => !isManagedSection(s.name));

  const managedPreamble = managed.preambleLines.filter((line) => {
    const kv = line.match(KEY_RE);
    return kv && MANAGED_TOP_KEYS.includes(kv[1]);
  });

  const blocks = [];
  const preamble = [...trimTrailingBlank(keptPreamble), ...managedPreamble];
  if (preamble.length) blocks.push(preamble.join('\n'));
  for (const s of managed.sections) {
    if (isManagedSection(s.name)) blocks.push(trimTrailingBlank(s.lines).join('\n'));
  }
  for (const s of keptSections) {
    blocks.push(trimTrailingBlank(s.lines).join('\n'));
  }
  return blocks.filter((b) => b.trim()).join('\n\n') + '\n';
}

/**
 * 校验编辑器模式录入的受管片段：
 *   - 顶层只允许受管键（防止把本机状态写进配置档）；
 *   - section 只允许 [model_providers.*]；
 *   - section 头必须可解析。
 * 不校验值语法（TOML 子集由调用方/用户负责），只守住边界。
 */
function assertValidManagedToml(text) {
  if (!String(text || '').trim()) {
    throw new Error('配置内容为空');
  }
  let section = null;
  let hasManagedContent = false;
  for (const [index, line] of String(text).split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const header = line.match(HEADER_RE);
    if (header) {
      if (header[1]) {
        throw new Error(`第 ${index + 1} 行不允许数组 section`);
      }
      section = (header[1] || header[2]).trim();
      if (!isManagedSection(section)) {
        throw new Error(`不允许的 section: [${section}]（仅支持 [model_providers.*]）`);
      }
      hasManagedContent = true;
      continue;
    }

    const kv = line.match(KEY_RE);
    if (!kv) {
      throw new Error(`第 ${index + 1} 行不是可识别的键值或 section`);
    }
    const value = line.slice(line.indexOf('=') + 1).trim();
    if (!value || value.startsWith('#')) {
      throw new Error(`第 ${index + 1} 行的键 ${kv[1]} 缺少值`);
    }
    if (!section && !MANAGED_TOP_KEYS.includes(kv[1])) {
      throw new Error(`不允许的顶层键: ${kv[1]}（仅支持 ${MANAGED_TOP_KEYS.join('、')}）`);
    }
    hasManagedContent = true;
  }
  if (!hasManagedContent) {
    throw new Error('配置中没有任何受管键或 provider section');
  }
}

/** 从受管片段中提取展示摘要：模型、provider、base_url、wire_api。 */
function summarizeToml(text) {
  const { preambleLines, sections } = splitToml(text);
  const pick = (lines, key) => {
    for (const line of lines) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
      if (m) return m[1];
    }
    return '';
  };
  let baseUrl = '';
  let wireApi = '';
  for (const s of sections) {
    if (!isManagedSection(s.name)) continue;
    baseUrl = baseUrl || pick(s.lines, 'base_url');
    wireApi = wireApi || pick(s.lines, 'wire_api');
  }
  return {
    model: pick(preambleLines, 'model'),
    provider: pick(preambleLines, 'model_provider'),
    reasoningEffort: pick(preambleLines, 'model_reasoning_effort'),
    baseUrl,
    wireApi,
  };
}

/**
 * 从完整 config.toml 中提取受管片段（受管顶层键 + [model_providers.*] section），
 * 用于「复制当前配置为配置档」。本机状态 section 不进入结果。
 */
function extractManagedToml(fullText) {
  const { preambleLines, sections } = splitToml(fullText);
  const managedPreamble = preambleLines.filter((line) => {
    const kv = line.match(KEY_RE);
    return kv && MANAGED_TOP_KEYS.includes(kv[1]);
  });
  const blocks = [];
  if (managedPreamble.length) blocks.push(managedPreamble.join('\n'));
  for (const s of sections) {
    if (isManagedSection(s.name)) blocks.push(trimTrailingBlank(s.lines).join('\n'));
  }
  return blocks.join('\n\n') + '\n';
}

/** 构造 TOML 字符串值（转义反斜杠与引号）。 */
function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

module.exports = {
  MANAGED_TOP_KEYS,
  splitToml,
  isManagedSection,
  mergeConfig,
  extractManagedToml,
  assertValidManagedToml,
  summarizeToml,
  tomlString,
};
