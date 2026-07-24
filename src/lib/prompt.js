'use strict';

const readline = require('readline');

/**
 * 零依赖的最小交互提示模块，提供与 `prompts` 包兼容的调用子集：
 *
 *   const { name } = await prompt({ type, name, message, ... }, { onCancel });
 *
 * 支持的 type：text、password、select、confirm。每次仅处理单个问题对象。
 * 用户按 Ctrl-C 或遇到 EOF 时调用 onCancel（若提供），否则返回 {}。
 *
 * 架构（关键）：按 stdin 是否为 TTY 分成两套完全独立、互不混用的实现，
 * 从根源上避免「raw 模式 + readline 抢占同一个 stdin」导致的终端状态损坏：
 *
 *   - TTY：全程使用原始模式 + keypress 事件，不创建任何 readline 接口。
 *          select 支持 ↑/↓ 方向键，text/password 自带最小行编辑。
 *   - 非 TTY（管道）：使用一个常驻的 readline 行队列，select 按编号选择。
 *          常驻队列避免了反复 rl.question 丢失缓冲输入行的问题。
 *
 * 进程内 isTTY 是固定的，因此两套实现不会在同一次运行里交叉。
 */

function cancelled() {
  const e = new Error('已取消');
  e.cancelled = true;
  return e;
}

async function prompt(question, { onCancel } = {}) {
  try {
    const value = await ask(question);
    return { [question.name]: value };
  } catch (err) {
    if (err && err.cancelled) {
      if (typeof onCancel === 'function') onCancel();
      return {};
    }
    throw err;
  }
}

function ask(q) {
  const tty = Boolean(process.stdin.isTTY);
  switch (q.type) {
    case 'text':
      return tty ? ttyLine(q, false) : pipeLine(q, false);
    case 'password':
      return tty ? ttyLine(q, true) : pipeLine(q, true);
    case 'confirm':
      return tty ? ttyConfirm(q) : pipeConfirm(q);
    case 'select':
      return tty ? ttySelect(q) : pipeSelect(q);
    default:
      throw new Error(`不支持的提示类型: ${q.type}`);
  }
}

function firstEnabled(choices, start) {
  if (choices[start] && !choices[start].disabled) return start;
  const idx = choices.findIndex((c) => !c.disabled);
  return idx >= 0 ? idx : 0;
}

/* ===================== TTY 实现（原始模式 + keypress） ===================== */

// 挂上 keypress 监听并进入原始模式；返回清理函数。
function beginKeys(onKey) {
  const input = process.stdin;
  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  const handler = (str, key) => onKey(str, key || {});
  input.on('keypress', handler);
  let done = false;
  return function cleanup() {
    if (done) return;
    done = true;
    input.removeListener('keypress', handler);
    input.setRawMode(wasRaw || false);
    input.pause();
  };
}

// 文本 / 密码：自带最小行编辑（打印字符、退格、回车提交）。
function ttyLine(q, hidden) {
  const output = process.stdout;
  return new Promise((resolve, reject) => {
    let buf = '';
    const printPrompt = () => output.write(`${q.message}: `);
    printPrompt();

    const cleanup = beginKeys((str, key) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        output.write('\n');
        return reject(cancelled());
      }
      if (key.name === 'return' || key.name === 'enter' || str === '\r' || str === '\n') {
        // 校验
        if (typeof q.validate === 'function') {
          const res = q.validate(buf);
          if (res !== true) {
            output.write(`\n  ${typeof res === 'string' ? res : '输入无效'}\n`);
            buf = '';
            printPrompt();
            return;
          }
        }
        cleanup();
        output.write('\n');
        return resolve(buf);
      }
      if (key.name === 'backspace' || str === '\x7f' || str === '\b') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          if (!hidden) output.write('\b \b');
        }
        return;
      }
      // 普通可打印字符（忽略控制/方向键等）
      if (str && !key.ctrl && !key.meta && str.charCodeAt(0) >= 0x20) {
        buf += str;
        if (!hidden) output.write(str); // 密码不回显，也不暴露长度
      }
    });
  });
}

// 确认：单键 y/n，回车用默认值。
function ttyConfirm(q) {
  const output = process.stdout;
  const def = q.initial !== false;
  const hint = def ? 'Y/n' : 'y/N';
  return new Promise((resolve, reject) => {
    output.write(`${q.message} (${hint}) `);
    const cleanup = beginKeys((str, key) => {
      if (key.ctrl && key.name === 'c') { cleanup(); output.write('\n'); return reject(cancelled()); }
      if (key.name === 'return' || key.name === 'enter' || str === '\r' || str === '\n') {
        cleanup(); output.write('\n'); return resolve(def);
      }
      const ch = (str || '').toLowerCase();
      if (ch === 'y') { cleanup(); output.write('y\n'); return resolve(true); }
      if (ch === 'n') { cleanup(); output.write('n\n'); return resolve(false); }
      // 其它按键忽略
    });
  });
}

// 单选：↑/↓ 选择，回车确认。
function ttySelect(q) {
  const output = process.stdout;
  const choices = q.choices;
  return new Promise((resolve, reject) => {
    let index = firstEnabled(choices, Math.max(0, q.initial || 0));
    let rendered = false;

    const render = () => {
      if (rendered) readline.moveCursor(output, 0, -(choices.length + 1));
      readline.clearScreenDown(output);
      output.write(`${q.message}（↑/↓ 选择，回车确认）\n`);
      choices.forEach((c, i) => {
        const pointer = i === index ? '❯' : ' ';
        const dim = c.disabled ? ' (不可用)' : '';
        output.write(`${pointer} ${c.title}${dim}\n`);
      });
      rendered = true;
    };

    const move = (delta) => {
      do {
        index = (index + delta + choices.length) % choices.length;
      } while (choices[index].disabled);
      render();
    };

    const cleanup = beginKeys((str, key) => {
      if (key.ctrl && key.name === 'c') { cleanup(); output.write('\n'); return reject(cancelled()); }
      if (key.name === 'up' || key.name === 'k') return move(-1);
      if (key.name === 'down' || key.name === 'j') return move(1);
      if (key.name === 'return' || key.name === 'enter' || str === '\r' || str === '\n') {
        if (choices[index].disabled) return;
        cleanup();
        return resolve(choices[index].value);
      }
      // 数字键快捷选择
      if (str && /[0-9]/.test(str)) {
        const n = parseInt(str, 10);
        if (n >= 1 && n <= choices.length && !choices[n - 1].disabled) {
          index = n - 1;
          render();
        }
      }
    });

    render();
  });
}

/* ===================== 非 TTY 实现（管道：常驻 readline 行队列） ===================== */

let reader = null;
function getReader() {
  if (reader) return reader;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  let waiter = null;
  let ended = false;

  rl.on('line', (line) => {
    if (waiter) { const w = waiter; waiter = null; w.resolve(line); }
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    if (waiter) { const w = waiter; waiter = null; w.resolve(null); }
  });

  reader = {
    nextLine() {
      if (lines.length) return Promise.resolve(lines.shift());
      if (ended) return Promise.resolve(null);
      return new Promise((resolve) => { waiter = { resolve }; });
    },
    close() { try { rl.close(); } catch { /* ignore */ } },
  };
  return reader;
}

// 供进程结束时清理（仅非 TTY 路径创建过 reader）。
function closeShared() {
  if (reader) { reader.close(); reader = null; }
}

async function pipeLine(q, _hidden) {
  const r = getReader();
  for (;;) {
    process.stdout.write(`${q.message}: `);
    const answer = await r.nextLine();
    if (answer === null) throw cancelled();
    if (typeof q.validate === 'function') {
      const res = q.validate(answer);
      if (res !== true) {
        process.stdout.write(`  ${typeof res === 'string' ? res : '输入无效'}\n`);
        continue;
      }
    }
    return answer;
  }
}

async function pipeConfirm(q) {
  const r = getReader();
  const def = q.initial !== false;
  const hint = def ? 'Y/n' : 'y/N';
  process.stdout.write(`${q.message} (${hint}) `);
  const answer = await r.nextLine();
  if (answer === null) throw cancelled();
  const a = answer.trim().toLowerCase();
  if (a === '') return def;
  return a === 'y' || a === 'yes';
}

async function pipeSelect(q) {
  const r = getReader();
  const choices = q.choices;
  process.stdout.write(`${q.message}\n`);
  choices.forEach((c, i) => {
    const dim = c.disabled ? ' (不可用)' : '';
    process.stdout.write(`  ${i + 1}) ${c.title}${dim}\n`);
  });
  const def = firstEnabled(choices, Math.max(0, q.initial || 0));
  for (;;) {
    process.stdout.write(`输入编号 [${def + 1}]: `);
    const answer = await r.nextLine();
    if (answer === null) throw cancelled();
    const trimmed = answer.trim();
    const n = trimmed === '' ? def + 1 : parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < 1 || n > choices.length || choices[n - 1].disabled) {
      process.stdout.write('  无效编号\n');
      continue;
    }
    return choices[n - 1].value;
  }
}

module.exports = prompt;
module.exports.closeShared = closeShared;
