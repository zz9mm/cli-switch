'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseCommandArgs } = require('../src/lib/args');

test('子命令参数解析拒绝未知选项与多余位置参数', () => {
  assert.throws(
    () => parseCommandArgs(['profile', 'extra'], { positionalCounts: [0, 1], usage: 'clis codex use [名称]' }),
    /用法/,
  );
  assert.throws(
    () => parseCommandArgs(['profile', '--force'], {
      allowedFlags: ['yes'], positionalCounts: [0, 1], usage: 'clis codex delete [名称] [--yes]',
    }),
    /未知选项: --force/,
  );
});

test('子命令参数解析保留允许的标志和位置参数', () => {
  const parsed = parseCommandArgs(['profile', '--yes'], {
    allowedFlags: ['yes'], positionalCounts: [0, 1], usage: 'clis claude delete [名称] [--yes]',
  });
  assert.deepStrictEqual(parsed.positional, ['profile']);
  assert.ok(parsed.flags.has('yes'));
});
