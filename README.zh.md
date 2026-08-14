# CiteGuard

[English](README.md) | 中文

[![CI](https://github.com/Chhlafiu4312/citeguard/actions/workflows/ci.yml/badge.svg)](https://github.com/Chhlafiu4312/citeguard/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)

CiteGuard 是 DeepSeek Harness 的引用检查器与受限元数据核验工具。它可以从草稿中提取 DOI、arXiv、URL 和 Markdown 引用，完成可机械验证的检查，并为每个结论标明正确的置信边界。

它绝不会把“链接能打开”写成“论点已被证明”。

## 它解决什么问题

AI 生成的引用可能以不同方式出错：标识符格式错误、论文不存在、标题张冠李戴、链接失效，或者真实论文被放在一个它并不支持的论点旁。CiteGuard 负责发现机械层面的错误，同时把语义判断明确留给人工审阅。

```text
草稿 ──> 提取与规范化 ──> 离线校验 ──> 受限的提供方核验
                         │                    │
                         └─ 邻近关系标记 ─────┴─> 证据回执
```

## 核心能力

- 提取、规范化并去重 DOI、arXiv、HTTP URL 和 Markdown 链接。
- 为每条引用记录行列位置、上下文和同句邻近关系。
- 通过固定 Crossref API 核验 DOI，通过固定 arXiv API 核验预印本元数据，并将重定向锁定在原提供方主机。
- 对带描述性标题的 Markdown 链接进行标题相似度检查。
- 只有显式设置 `networkMode=full` 才会请求普通 URL。
- SSRF 防护：仅允许 HTTP(S)、拒绝 URL 凭据、按规范子网拒绝 IPv4/IPv6 私有及特殊地址、检查全部 DNS 答案、逐跳检查重定向，并对完整响应体执行超时与大小限制。
- 提供 `citeguard_check` Harness 工具、独立 CLI、稳定 JSON 回执和 TypeScript API。
- 限制单次输入与引用数量，避免草稿触发无界网络请求。

完整证据契约见 [docs/design.md](docs/design.md)。

## 快速开始

从源码构建需要 Node.js 22.19 或更高版本，以及 pnpm。

```sh
pnpm install
pnpm run prepare
node lib/cli.js --text "This result follows prior work (10.1234/example)."
```

CLI 默认完全离线。可以只启用固定元数据提供方，或显式允许普通公网 URL：

```sh
node lib/cli.js --file draft.md --online
node lib/cli.js --file draft.md --full --json --fail-on mismatch,unreachable,blocked
```

退出码：`0` 表示成功，`1` 表示出现 `--fail-on` 指定状态，`2` 表示参数、I/O 或核验设置错误。

## 安装到 DeepSeek Harness

源码已经发布到 GitHub，npm 包尚未发布。请在本机终端中运行以下命令，不要粘贴到 Harness 的聊天输入框中；无需预先全局安装 `dsh`。

```sh
npx -y @deepseek-ai/dsh plugin --profile web add https://github.com/Chhlafiu4312/citeguard/releases/download/v0.1.6/dsh-citeguard-0.1.6.tgz
npx -y @deepseek-ai/dsh --profile web --dump-config

# 安装后重启正在运行的 Web UI。
npx -y @deepseek-ai/dsh web

# 或构建并安装本地 tarball。
pnpm pack
npx -y @deepseek-ai/dsh plugin --profile web add ./dsh-citeguard-0.1.6.tgz
```

以上命令会安装到 Web UI 使用的 `web` profile；如果只使用终端模式，请把 `web` 替换为 `headless`。包内的 [cordis.patch.yml](cordis.patch.yml) 会注册 `citeguard`。可选的 `dsh-citeguard/invariant` companion 保留给显式挂载 Harness `invariants` 服务的自定义 profile；官方 `headless` 与 `web` profile 默认不挂载该服务。激活后的工具是 `citeguard_check({ text, online? })`。

## 状态含义

| 状态 | 含义 |
|---|---|
| `verified` | DOI 或 arXiv 标识符在受限元数据提供方解析成功，显式标题也通过相似度阈值。 |
| `reachable` | 显式允许的普通 URL 在资源限制内成功响应。 |
| `mismatch` | 元数据解析成功，但链接标签与提供方标题相似度不足。 |
| `unverified` | 本地语法可接受，但离线模式或网络策略没有发出请求。 |
| `invalid` | 标识符或 URL 未通过本地语法检查。 |
| `unreachable` | DNS、超时、HTTP 或提供方错误导致无法核验。 |
| `blocked` | 请求违反网络安全策略或资源限制。 |

任何状态都不代表语义蕴含、研究质量或事实真伪。“论点关联”只表示引用出现在同一个句子中。

## 配置

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `enabled` | `true` | 注册 `citeguard_check` 工具。 |
| `networkMode` | `metadata` | `off`、固定提供方 `metadata` 或 SSRF 检查后的 `full`。 |
| `timeoutMs` | `8000` | 覆盖响应头和完整响应体读取的单次请求时限。 |
| `maxResponseBytes` | `1048576` | 最大响应体。 |
| `maxRedirects` | `4` | 最多允许的逐跳验证重定向次数。 |
| `minTitleSimilarity` | `0.55` | 显式标题标签所需的词集合相似度。 |
| `maxTextChars` | `200000` | 单次输入最大长度。 |
| `maxCitations` | `100` | 单次最多核验的引用数量。 |

完整默认值见 [cordis.patch.yml](cordis.patch.yml)。

## 安全边界

- `metadata` 模式只访问 Crossref 和 arXiv；精确主机白名单会在 DNS 解析前拒绝跨提供方重定向，普通 URL 不会被请求。
- `full` 模式需要主动开启，并在每次重定向前重新检查目标。
- DNS 检查可以降低 SSRF 风险，但不能让远程内容自动可信。
- HTML 解析保持浅层，不执行脚本。
- Crossref/arXiv 的可用性、限流和元数据质量不由 CiteGuard 控制。
- 标题词重合只用于发现错配，不是作者身份或抄袭判断。
- 是否真正支持某个论点，仍然需要人工阅读来源。

安全问题请按 [SECURITY.md](SECURITY.md) 报告，不要在公开 Issue 中发布私人申请材料或攻击目标。

## 开发与状态

```sh
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run prepare
pnpm run build
```

`full` 模式会逐个验证重定向目标，并把连接固定到已经通过校验的公网 DNS 地址集合，避免校验后再次解析产生的 DNS 重绑定竞态。自定义 fetch transport 必须只连接第三个参数收到的已验证地址集合；内置 transport 会强制执行这一约束。

测试全部使用确定性假提供方，不会发起真实网络请求。`0.1.6` 将元数据重定向锁定在 Crossref 和 arXiv 的配置提供方主机，并发布于 [Chhlafiu4312/citeguard](https://github.com/Chhlafiu4312/citeguard)。Release tarball 同时提供 SHA-256 校验文件和 GitHub 构建来源证明。包仍保持 `private: true`，不会发布到 npm。

采用 BSD-3-Clause 许可证，详见 [LICENSE](LICENSE)。
