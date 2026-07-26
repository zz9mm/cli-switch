---
id: knowledge-windows-npm-test-glob
type: knowledge
title: Windows 下 npm scripts 中 node --test 的 glob 引号陷阱
status: active
created: 2026-07-25
updated: 2026-07-25
tags: [windows, node, npm, testing]
---

# Windows 下 npm scripts 中 node --test 的 glob 引号陷阱

## 来源

- 2026-07-25 cli-switch 项目排障：`npm test` 报 `tests 0`。
- `package.json` 的 test 脚本。

## 摘要

npm 在 Windows 上通过 cmd.exe 执行 scripts，cmd 不做 glob 展开且不去除单引号；`node --test 'test/**/*.test.js'` 的单引号会被当作模式字面量传入，匹配 0 个文件，测试静默全部跳过。

## 内容

- 症状：`npm test` 输出 `tests 0 / pass 0 / fail 0`，退出码为 0——**静默漏测**，CI 也会显示通过。
- 原因：cmd.exe 把 `'test/**/*.test.js'`（含单引号）原样传给 node；node 的 glob 匹配器找不到带引号文件名的文件。Unix shell 会去掉单引号，所以同一脚本在 macOS/Linux 正常。
- 修复：改用双引号 `node --test "test/**/*.test.js"`，cmd 会剥离双引号，node 收到干净的模式并自行展开（Node >= 21 支持 --test glob）。
- 注意 `node --test test/`（目录参数）在部分版本会被当作入口模块而非扫描目录，报 `Cannot find module '<dir>'`；glob 模式是跨平台最稳的写法。
- 排查同类"测试为 0 但不报错"问题时，先单独跑 `node --test <文件>` 确认测试本身能被发现。

## 使用时机

在任何 Windows 开发的项目中编写或审查 package.json scripts、发现测试数量异常为 0 时。

## 上下文链接

- Related: [[knowledge/claude-settings-profile-validation/content]]
