# 客户账户与 AI 授权交付手册

## 当前边界

开发分支：`codex/accounts-ai-authorization`。前台基线：`2b852c6`。原画板 `docs/lowkkey-handoff/frontend/lowkkey-frontend.html` 保持原样。包版本仍为 0.6.0；协议更新为 3.0.0。

代码支持邀请制 Google / 邮箱验证码、设备会话、用户账户归属、OAuth/MCP 与对话卡片。**代码与隔离测试不代表 Google/Resend 配置、公网 Claude/ChatGPT 或 iPhone 真机已经验收。** 当前公网仍沿用 Access 配置；本分支没有自动发布。

### 数据和身份

- Better Auth 原生 D1 保存登录身份、会话和验证码摘要。`auth_owners` 将身份映射到稳定业务账户 ID。
- 邀请绑定已验证邮箱。Google 与 OTP 不通过未验证邮箱文字认领旧账户；已有用户显式绑定 Google。
- 客户写操作必须同时有应用 Cookie、同源 Origin 与 `X-Lowkkey-Account`。浏览器离线队列按账户存储；换号不能发送另一个账户的队列。
- `/v1/account/claim-access` 要求同时具有新客户会话与有效的旧 Access JWT assertion，只允许空的新账户认领。Access 策略须只保护迁移路径并与旧应用的 AUD 一致。已有业务事实不会按邮箱自动搬迁。
- 账本不更新、不删除。更正提案中的 `corrects` 在本人确认时追加 revert 和替代条目；未确认不影响派生状态。

## 准备测试环境

使用与开发、演练、正式环境不同的 D1 和 KV。复制 `wrangler.production.example.jsonc` 为环境配置，替换域名、数据库 ID、KV ID。它是模板，不可直接部署占位符。

客户模式变量：

| 名称 | 用途 |
| --- | --- |
| `AUTH_MODE=customer` | 启用应用客户会话 |
| `APP_ORIGIN` | 唯一 HTTPS 客户域名，也是 OAuth issuer |
| `AUTH_EMAIL_FROM` | 已验证发信域名的地址，例如 `lowkkey <login@your-domain>` |
| `AI_CONNECTION_ENABLED=0` | 默认隐藏尚未验收的公网连接操作；路由与授权检查通过后改为 1 |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | 仅旧账户迁移或 Access 模式需要 |

用 Wrangler secrets 设置以下值，**不要写进 JSON、Git 或截图**：

```sh
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.customer.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.customer.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.customer.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.customer.jsonc
```

Better Auth secret 至少 32 字符，使用密码生成器随机生成。Google OAuth 仅申请 openid/email/profile，允许回调为 `https://你的域名/api/auth/callback/google`。Resend 验证发信域名后才能实际发送邮件。验证码有效 5 分钟，6 位数字，限制尝试次数和发送频率；发送失败明确返回失败。

### 迁移与邀请

远程执行前核对当前配置的 D1 ID、账户和环境。先备份/记录 D1 Time Travel 恢复点，再在隔离环境演练 0003 迁移；不导入本地测试记录。

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.customer.jsonc
node scripts/invite.mjs add 受邀邮箱 wrangler.customer.jsonc --remote
```

本地操作改用 `--local`；默认持久目录 `.data/v02`，可通过 `LOWKKEY_DATA_DIR` 指定隔离目录。撤销邀请：

```sh
node scripts/invite.mjs revoke 受邀邮箱 wrangler.customer.jsonc --remote
```

撤销邀请会关闭该身份会话并停用其客户端业务访问；客户端旧令牌和刷新均受 D1 授权状态约束。网页单独撤销客户端还会撤销其 OAuth grant。

### 路由与 Cloudflare Access

客户站点不能继续用覆盖整个域名的 Access 登录墙，否则 Claude 云端无法访问发现与 token 端点。保护职责如下：

- `/api/auth/*`：应用认证、同源检查、验证码/身份提供商。
- `/v1/*`：应用客户 Cookie。模型 Bearer 令牌不被视为用户身份。
- `/authorize`：应用登录后恢复原授权请求，选择 read / submit / propose。
- `/.well-known/*`、`/oauth/register`、`/oauth/token`：遵守 OAuth 标准公开发现/注册/换令牌；由 OAuth Provider 验证请求。
- `/mcp`：OAuth Bearer 与资源受众、D1 客户端状态共同验证。
- Access 只保留管理路径及旧账户迁移路径。不要为解决连接问题关闭应用鉴权。

## AI 的实际能力

工具的唯一源码是 `packages/protocol/src/mcp.ts`；运行时直接使用输入、输出、描述和权限定义。`npm run protocol:emit` 更新 OpenAPI、JSON Schema、工具清单。

推荐对话流程：

1. `get_state` 获取 revision、时区、计划与规则结果；条目按 cursor 分页，规则仍依据完整有效账本。
2. `list_exercises` 查询动作 ID、器械、单位和单只重量含义。
3. `propose_change` 提交明确的 program patch 和读取时的 `expectedRevision`；自定义动作置于 `exercises`，与计划一起确认生效，不能重定义历史动作 ID。
4. `propose_entries` 提交捕获时刻、本地日期、时区、幂等键与置信度。训练记录必须使用明确 sessionId，同场组共享它；不要伪造开始/结束时间。
5. 返回精确审阅链接。网页一次确认全部记录，并重新运行闸门；过期状态返回冲突。
6. `get_review` 读取 accepted/skipped 等实际结果。`get_history` 按场次分页；没有开始/结束事实时返回 null。
7. 错误更正使用原条目 ID `corrects`。组别纠正可用 `set_annotation`。两者均需用户确认。

模型不能改 HTML、部署代码、直接入账、撤销、确认或决定宏观调整。工具权限按 read / submit / propose 裁剪。MCP Apps 卡片是受控展示资源，首版确认入口仍进入用户网页；没有卡片能力的客户端仍得到摘要与链接。

协议 3.0.0 的主要变化是工具历史返回分页对象 `{items,nextCursor}`，并严格约束模型草稿、计划 patch 和输出。旧调用方应根据新的 `tools/list` 更新，不假设旧数组返回。

## 本地检查与预览

```sh
npm run check
npm run protocol:emit
npm test
npm run build
npm run test:e2e
npm run test:oauth
npm run preview:empty
npm run preview:rehearsal
```

macOS 使用仓库 Node 与 fence；Linux CI 使用系统 Node 24.21.0。浏览器测试使用独立 D1、Chromium 和 WebKit。OAuth 测试会启动并清理自己的本地服务，不连接真实 Claude。演练入口和测试控制器仅由独立脚本运行，不导入产品入口。

`.github/workflows/check.yml` 提供检查，但**仓库分支保护还需要 GitHub 设置**：将 `Product checks / check` 设为 main 的必需检查，要求通过 PR 合并。Cloudflare Git 集成只跟踪 main。配置检查不会自动等同于远程保护已启用。

## 发布与回滚

1. 先验证邀请登录、退出、设备管理、过期验证码、账户隔离和旧身份迁移；确认新客户模式独立运行。
2. 核对原画板无修改，生产资源没有演练控制器或测试个人事实。
3. 测试配置构建：`LOWKKEY_WRANGLER_CONFIG=wrangler.customer.jsonc npx vite build`。部署使用构建日志中实际生成的 Wrangler 配置，Worker 名称中的连字符可能映射为下划线目录。
4. 部署后读取 `/healthz` 的 `version`，与 Git 提交 SHA、Cloudflare Deployment 一致。构建 SHA 标识源码基线；只在干净提交上发布。
5. 回滚应用使用 Cloudflare 已保存版本；不反向删除认证表，不删除用户事实，不复原旧账本来掩盖后续记录。密钥、域名、数据迁移须兼容回滚版本。
6. 请求响应携带 X-Request-ID，API 错误只记录匿名请求 ID 和错误码，不记录原文、邮箱验证码或令牌。邮件错误对用户明确可重试。

## 公网与真机验收记录（仍待完成）

- 正式域名、Google OAuth、Resend、测试 D1/KV 与 secrets 配置。
- Google 同意/拒绝/重复回调、邮箱真实送达、多设备退出、旧 Access 所有权认领。
- Claude 官方客户端：授权 → 空账户计划（含自定义动作）→ 网页审阅 → 五条训练记录 → 一次入账 → 图表 → AI 回读 → 更正/撤销 → 撤销授权。
- ChatGPT：在确实支持自定义连接的账户上重复流程，不假设所有账户可用。
- MCP Apps 官方宿主渲染与刷新。自动化宿主模拟通过不等于官方客户端支持已验收。
- iPhone Safari 与主屏幕：记录设备/iOS 版本，验证键盘、安全区、弱网、中文输入、抽屉返回、退出/换号。
- GitHub Actions 的 Linux 云端首跑、必需检查与 Cloudflare 提交 SHA。

只有实际通过的设备和客户端才标记为支持。
