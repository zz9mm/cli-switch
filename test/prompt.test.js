'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { createPrompt } = require('../src/lib/prompt');

class FakeTtyInput extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.isRaw = false;
    this.rawModes = [];
    this.resumed = 0;
    this.paused = 0;
  }

  setRawMode(value) {
    this.isRaw = value;
    this.rawModes.push(value);
  }

  resume() {
    this.resumed += 1;
  }

  pause() {
    this.paused += 1;
  }
}

class CaptureOutput {
  constructor() {
    this.chunks = [];
    this.isTTY = false;
  }

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  text() {
    return this.chunks.join('');
  }
}

function press(input, str, key = {}) {
  input.emit('keypress', str, key);
}

function ttyPrompt() {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  return { input, output, prompt: createPrompt({ input, output }) };
}

test('TTY 文本输入支持校验重试和退格，并恢复 raw mode', async () => {
  const { input, output, prompt } = ttyPrompt();
  const result = prompt({
    type: 'text',
    name: 'name',
    message: '名称',
    validate: (value) => (value.length >= 2 ? true : '至少两个字符'),
  });

  press(input, 'a');
  press(input, '\r', { name: 'return' });
  press(input, 'a');
  press(input, 'b');
  press(input, 'c');
  press(input, '\x7f', { name: 'backspace' });
  press(input, 'd');
  press(input, '\r', { name: 'return' });

  assert.deepStrictEqual(await result, { name: 'abd' });
  assert.match(output.text(), /至少两个字符/);
  assert.ok(output.text().includes('\b \b'));
  assert.deepStrictEqual(input.rawModes, [true, false]);
  assert.strictEqual(input.resumed, 1);
  assert.strictEqual(input.paused, 1);
});

test('TTY 密码输入不回显内容或长度', async () => {
  const { input, output, prompt } = ttyPrompt();
  const result = prompt({ type: 'password', name: 'secret', message: '密钥' });
  for (const char of 'top-secret') press(input, char);
  press(input, '\r', { name: 'return' });

  assert.deepStrictEqual(await result, { secret: 'top-secret' });
  assert.strictEqual(output.text(), '密钥: \n');
  assert.ok(!output.text().includes('top-secret'));
  assert.ok(!output.text().includes('*'));
  assert.deepStrictEqual(input.rawModes, [true, false]);
});

test('TTY 确认支持默认值、显式选择和 Ctrl-C 取消', async () => {
  const first = ttyPrompt();
  const defaultResult = first.prompt({ type: 'confirm', name: 'ok', message: '继续', initial: false });
  press(first.input, '\r', { name: 'return' });
  assert.deepStrictEqual(await defaultResult, { ok: false });

  const second = ttyPrompt();
  const yesResult = second.prompt({ type: 'confirm', name: 'ok', message: '继续' });
  press(second.input, 'Y', { name: 'y' });
  assert.deepStrictEqual(await yesResult, { ok: true });
  assert.match(second.output.text(), /y\n$/);

  const third = ttyPrompt();
  let cancelled = false;
  const cancelResult = third.prompt(
    { type: 'confirm', name: 'ok', message: '继续' },
    { onCancel: () => { cancelled = true; } },
  );
  press(third.input, '\x03', { ctrl: true, name: 'c' });
  assert.deepStrictEqual(await cancelResult, {});
  assert.strictEqual(cancelled, true);
  assert.deepStrictEqual(third.input.rawModes, [true, false]);
});

test('TTY 单选支持方向键、数字键并跳过禁用项', async () => {
  const choices = [
    { title: 'A', value: 'a' },
    { title: 'B', value: 'b', disabled: true },
    { title: 'C', value: 'c' },
  ];
  const first = ttyPrompt();
  const moved = first.prompt({ type: 'select', name: 'choice', message: '选择', choices });
  press(first.input, '', { name: 'down' });
  press(first.input, '\r', { name: 'return' });
  assert.deepStrictEqual(await moved, { choice: 'c' });
  assert.match(first.output.text(), /B \(不可用\)/);

  const second = ttyPrompt();
  const numbered = second.prompt({ type: 'select', name: 'choice', message: '选择', choices, initial: 2 });
  press(second.input, '1');
  press(second.input, '\r', { name: 'return' });
  assert.deepStrictEqual(await numbered, { choice: 'a' });

  const third = ttyPrompt();
  await assert.rejects(
    third.prompt({
      type: 'select', name: 'choice', message: '选择', choices: [{ title: 'X', value: 'x', disabled: true }],
    }),
    /没有可用项/,
  );
});

test('管道模式复用行队列并覆盖文本、密码、确认和选择', async () => {
  const input = new PassThrough();
  input.isTTY = false;
  const output = new CaptureOutput();
  const prompt = createPrompt({ input, output });

  const textResult = prompt({
    type: 'text', name: 'name', message: '名称', validate: (value) => (value === 'good' ? true : '无效名称'),
  });
  input.write('bad\ngood\n');
  assert.deepStrictEqual(await textResult, { name: 'good' });

  const passwordResult = prompt({ type: 'password', name: 'secret', message: '密钥' });
  input.write('pipe-secret\n');
  assert.deepStrictEqual(await passwordResult, { secret: 'pipe-secret' });

  const confirmResult = prompt({ type: 'confirm', name: 'ok', message: '继续', initial: true });
  input.write('\n');
  assert.deepStrictEqual(await confirmResult, { ok: true });

  const selectResult = prompt({
    type: 'select',
    name: 'choice',
    message: '选择',
    choices: [
      { title: 'A', value: 'a', disabled: true },
      { title: 'B', value: 'b' },
    ],
  });
  input.write('1\n2\n');
  assert.deepStrictEqual(await selectResult, { choice: 'b' });

  assert.match(output.text(), /无效名称/);
  assert.match(output.text(), /无效编号/);
  assert.ok(!output.text().includes('pipe-secret'));
  prompt.closeShared();
  input.end();
});

test('管道 EOF 触发取消，未知提示类型明确报错', async () => {
  const input = new PassThrough();
  input.isTTY = false;
  const output = new CaptureOutput();
  const prompt = createPrompt({ input, output });
  let cancelled = false;
  const pending = prompt(
    { type: 'text', name: 'name', message: '名称' },
    { onCancel: () => { cancelled = true; } },
  );
  input.end();
  assert.deepStrictEqual(await pending, {});
  assert.strictEqual(cancelled, true);
  prompt.closeShared();

  await assert.rejects(
    prompt({ type: 'unknown', name: 'x', message: '未知' }),
    /不支持的提示类型/,
  );
});
