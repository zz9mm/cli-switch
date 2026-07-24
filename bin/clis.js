#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');
const prompt = require('../src/lib/prompt');

main(process.argv.slice(2))
  .catch((err) => {
    console.error(`错误: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // 释放共享的 stdin readline，确保进程正常退出。
    prompt.closeShared();
  });
