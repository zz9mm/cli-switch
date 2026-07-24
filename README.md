# clis — CLI 配置档管理器

为 AI 编码工具（首先支持 Claude Code）管理多份 API 配置档，方便在不同服务商 / 模型之间切换。

> 当前进度：已实现 **创建配置档**（计划 `01`）与 **删除配置档**（计划 `05`），并搭好共享骨架供 02–04 扩展。

## 安装

零运行时依赖（交互提示为内置实现）。全局链接即可获得 `clis` 命令：

```bash
npm link      # 或 npm install -g .
```

需要 Node.js >= 16。

## 使用

引导菜单：

```bash
clis          # 选择 “Claude Code” → “创建配置档”
```

非交互入口：

```bash
clis claude create <名称>
clis claude delete <名称> --yes   # 非交互删除需显式 --yes 确认
```

创建流程提供两种录入方式：

- **从空白配置引导填写**：依次输入 API URL、选择鉴权方式、隐藏输入 Key，然后**从端点动态拉取模型列表**供选择。
  - 鉴权方式：`API Key`（写入 `ANTHROPIC_API_KEY`，走 `x-api-key`，官方 Anthropic）或 `Auth Token`（写入 `ANTHROPIC_AUTH_TOKEN`，走 `Authorization: Bearer`，适配 Kimi/Moonshot 等第三方）。
  - 模型：请求 `{base}/v1/models` 拉取真实可用模型；拉取失败（网络/鉴权错）自动回退为手动输入，不会卡住。
- **在编辑器中编辑 JSON**：用 `$VISUAL` / `$EDITOR` 打开模板，保存后做 JSON 校验（高级字段走这里）。

保存前会展示 **脱敏预览**（`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 只显示头尾），确认后写入。

### 删除配置档

```bash
clis                              # 菜单 → “删除配置档”，上下移动选择
clis claude delete <名称> --yes   # 非交互删除
```

- 交互模式：从列表选择后，需**输入配置档名称二次确认**，不匹配即取消。
- 非交互模式：缺少 `--yes` 时只展示摘要并拒绝删除（退出码非零），避免脚本误删。
- 删除前展示摘要（名称 / 模型 / 主机，**不含密钥**）；若删除的是当前生效配置档会额外提示，并在删除后清除状态记录。
- 只删除 `profiles/<名称>/` 目录本身，**不会修改** Claude Code 已写入的 `~/.claude/settings.json`。

## 数据与安全

- 配置档保存于 `~/.config/clis/claude/profiles/<名称>/settings.json`，可被 Claude Code 直接读取。
- 目录权限 `0700`，含密钥的文件权限 `0600`。
- 采用临时文件 + 原子重命名写入，取消或校验失败不会留下半成品。
- API Key 无回显输入；预览、日志、报错中均不输出完整密钥。

可用环境变量覆盖路径（便于测试）：`CLIS_CONFIG_HOME`、`CLAUDE_HOME`。

## 目录结构

```
bin/clis.js            可执行入口
src/cli.js             顶层路由（菜单 / 子命令）
src/claude/            Claude Code 相关命令
  index.js             菜单与子命令分发
  create.js            创建配置档流程（计划 01）
  delete.js            删除配置档流程（计划 05）
src/lib/               共享模块
  paths.js             路径集中管理
  validate.js          名称 / URL 校验
  mask.js              密钥脱敏
  fsutil.js            原子写入与目录权限
  profiles.js          配置档持久层
  state.js             当前配置档状态（state.json）
  models.js            从 {base}/v1/models 动态拉取模型
  editor.js            $EDITOR 临时文件编辑
  prompt.js            零依赖交互提示（text/password/select/confirm）
test/                  node:test 单元测试
```

## 测试

```bash
npm test
```
