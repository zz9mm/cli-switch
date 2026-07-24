# 创建配置档

## 目标

以引导方式创建 Claude Code 配置档。创建流程只提供两种内容录入方式：从空白配置填写，或在编辑器中编辑 JSON。

## 入口

默认入口是运行 `clis` 后依次选择“Claude Code”和“创建配置档”。

可选的非交互入口为：

```bash
clis claude create <名称>
```

## 引导流程

1. 输入配置档名称，并校验名称只含字母、数字、短横线或下划线。
2. 选择创建方式：
   - 从空白配置开始引导填写（默认）。
   - 在编辑器中编辑 JSON。
3. 选择引导填写时，依次输入 API URL、隐藏输入 API Key、选择预设模型或输入自定义模型名。
4. 将信息转换为 Claude Code 的 `env` 配置，包括 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 与 `ANTHROPIC_MODEL`。
5. 展示脱敏后的预览；用户确认后验证 JSON 并保存。

## 数据与安全

- 配置档保存于 `~/.config/clis/claude/profiles/<名称>/settings.json`。
- 配置目录权限为 `0700`，包含密钥的文件权限为 `0600`。
- API Key 使用无回显输入；预览、日志和报错中不得输出完整密钥。
- API URL 必须是有效的 `http://` 或 `https://` URL。
- 编辑器模式使用 `$VISUAL` 或 `$EDITOR` 打开临时 JSON 文件；保存后必须通过 JSON 校验。

## 验收标准

- 用户无需记忆参数即可完成一份包含 API URL、API Key 和模型的配置档创建。
- 取消或校验失败时，不产生半成品配置档。
- 保存后的 JSON 可被 Claude Code 读取，且密钥没有出现在终端输出中。
