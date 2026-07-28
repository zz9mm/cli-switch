# clis — CLI 配置档管理器

为 AI 编码工具（Claude Code 与 Codex）管理多份 API 配置档，方便在不同服务商 / 模型之间切换。

> 当前进度：Claude Code 与 Codex 的配置档管理（创建 / 切换 / 复制 / 查看编辑 / 删除）均已实现。

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
clis --help
clis claude create <名称>
clis claude use <名称>            # 切换为指定配置档（先备份现有配置）
clis claude current               # 显示当前由 clis 应用的配置档
clis claude copy current <新名称>  # 把当前生效配置存为配置档
clis claude copy <来源> <新名称>   # 复制既有配置档（非交互不覆盖同名）
clis claude show <名称>           # 查看摘要（密钥脱敏）
clis claude edit <名称>           # 引导更新或编辑器编辑 JSON
clis claude delete <名称> --yes   # 非交互删除需显式 --yes 确认
```

Codex 子命令同构（`clis codex ...`）：

```bash
clis codex create <名称>
clis codex use <名称>             # 受管合并写入 config.toml，保留本机状态（先备份）
clis codex current
clis codex copy current <新名称>  # 提取当前配置的受管部分 + auth.json 存为配置档
clis codex copy <来源> <新名称>
clis codex show <名称>
clis codex edit <名称>            # 引导更新或编辑器编辑 TOML
clis codex delete <名称> --yes
```

创建流程提供两种录入方式：

- **从空白配置引导填写**：依次输入 API URL、选择鉴权方式、隐藏输入 Key，然后**从端点动态拉取模型列表**供选择。
  - 鉴权方式：`API Key`（写入 `ANTHROPIC_API_KEY`，走 `x-api-key`，官方 Anthropic）或 `Auth Token`（写入 `ANTHROPIC_AUTH_TOKEN`，走 `Authorization: Bearer`，适配 Kimi/Moonshot 等第三方）。
  - 模型：请求 `{base}/v1/models` 拉取真实可用模型；拉取失败（网络/鉴权错）自动回退为手动输入，不会卡住。
  - 档位映射（可选）：主模型之外，可再为 Opus / Sonnet / Haiku / Fable 档位分别映射模型（写入 `ANTHROPIC_DEFAULT_<档位>_MODEL`，中转端常用）；默认不配置，各档位沿用主模型。
- **在编辑器中编辑 JSON**：用 `$VISUAL` / `$EDITOR` 打开空白文件编写完整 JSON，保存后做 JSON 校验（高级字段走这里）。

保存前会展示 **脱敏预览**（`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 只显示头尾），确认后写入。

### 切换配置档

- 列表显示名称 / 模型 / 主机 / 最近使用时间（**不含密钥**），确认后应用。
- 应用前先把现有 `~/.claude/settings.json` 备份到 `~/.config/clis/claude/backups/settings-<时间戳>.json`。
- 写入采用临时文件 + 原子重命名；配置档 JSON 损坏时立即中止，绝不留下截断文件。
- 切换成功后更新 `state.json`（只记名称与时间）与配置档的 `lastUsedAt`。

### 复制配置档

- 来源二选一：当前生效配置（只读 `~/.claude/settings.json`，不碰凭据文件）或既有配置档。
- 深拷贝写入新配置档，元数据（名称 / 创建时间）独立，后续编辑互不影响。
- 目标同名时非交互模式直接报错，交互模式需显式确认才覆盖。

### 查看 / 编辑配置档

- `show` 展示摘要：API URL / 模型 / 创建时间 / 最近使用，API Key 始终脱敏。
- `edit` 两种方式：引导更新（URL / Key / 模型，留空保持原值，Key 无回显）或 `$EDITOR` 编辑整份 JSON（高级字段）。
- 只有确认且 JSON 校验通过才原子覆盖；取消、编辑器异常退出、JSON 无效时原配置档保持不变。

### 删除配置档

```bash
clis                              # 菜单 → “删除配置档”，上下移动选择
clis claude delete <名称> --yes   # 非交互删除
```

- 交互模式：从列表选择后，需**输入配置档名称二次确认**，不匹配即取消。
- 非交互模式：缺少 `--yes` 时只展示摘要并拒绝删除（退出码非零），避免脚本误删。
- 删除前展示摘要（名称 / 模型 / 主机，**不含密钥**）；若删除的是当前生效配置档会额外提示，并在删除后清除状态记录。
- 只删除 `profiles/<名称>/` 目录本身，**不会修改** Claude Code 已写入的 `~/.claude/settings.json`。

## Codex 配置档的差异

Codex 的配置结构与 Claude Code 不同，处理方式也不同：

- **受管合并而非整文件覆盖**：`~/.codex/config.toml` 混合了配置档级内容（`model` / `model_provider` / `model_reasoning_effort` / `model_verbosity` 与 `[model_providers.*]`）与本机状态（`[projects.*]` 信任记录、`[tui.*]`、`[windows]` 等）。切换配置档只替换受管部分，本机状态**逐字保留**。
- **密钥独立文件**：API Key 存于 `~/.codex/auth.json`（`OPENAI_API_KEY`），配置档把它存为独立文件，可创建「不管理密钥」的配置档（走环境变量）。
- 配置档保存于 `~/.config/clis/codex/profiles/<名称>/`（`config.toml` 受管片段 + `auth.json` + `meta.json`）。
- 切换前同时备份 `config.toml` 与 `auth.json` 到 `~/.config/clis/codex/backups/`（共用时间戳，成对恢复）。
- 编辑器模式只允许受管内容（受管顶层键 + `[model_providers.*]`），防止把本机状态写进配置档；引导编辑只处理标准单 provider 结构，含高级字段时提示改用编辑器。

创建引导：Provider 名称 → API URL → Wire API（responses/chat）→ 隐藏输入 Key → 动态拉取模型 → 推理强度（low/medium/high/xhigh）。

可用环境变量覆盖路径（便于测试）：`CLIS_CONFIG_HOME`、`CODEX_HOME`。

## 数据与安全

- 配置档保存于 `~/.config/clis/claude/profiles/<名称>/settings.json`，可被 Claude Code 直接读取。
- 目录权限 `0700`，含密钥的文件权限 `0600`。
- 采用临时文件 + 原子重命名写入，取消或校验失败不会留下半成品。
- API Key 无回显输入；预览、日志、报错中均不输出完整密钥。

可用环境变量覆盖路径（便于测试）：`CLIS_CONFIG_HOME`、`CLAUDE_HOME`、`CODEX_HOME`。

## 目录结构

```
bin/clis.js            可执行入口
src/cli.js             顶层路由（菜单 / 子命令）
src/claude/            Claude Code 相关命令
  index.js             菜单与子命令分发
  create.js            创建配置档流程（计划 01）
  use.js               切换配置档 + current（计划 02）
  copy.js              复制配置档（计划 03）
  show.js              查看 / 编辑配置档（计划 04）
  delete.js            删除配置档流程（计划 05）
src/codex/             Codex 相关命令（子命令同构）
  index.js             菜单与子命令分发
  store.js             Codex 配置档持久层（config.toml 片段 + auth.json + meta.json）
  create.js            创建配置档流程 + 受管 TOML 构建器
  use.js               受管合并切换 + current
  copy.js              复制配置档（含 current 提取受管部分）
  show.js              查看 / 编辑配置档
  delete.js            删除配置档流程
src/lib/               共享模块
  paths.js             路径集中管理
  validate.js          名称 / URL 校验
  mask.js              密钥脱敏
  fsutil.js            原子写入与目录权限
  profiles.js          Claude 配置档持久层
  state.js             当前配置档状态（按工具隔离的 state.json）
  backup.js            切换前备份现有配置（settings.json / config.toml + auth.json）
  models.js            从 {base}/v1/models 动态拉取模型
  toml.js              行级 TOML 子集处理（受管合并，保留本机状态）
  editor.js            $EDITOR 临时文件编辑
  prompt.js            零依赖交互提示（text/password/select/confirm）
  args.js              子命令参数与选项校验
test/                  node:test 单元测试
```

## 测试

```bash
npm test
```
