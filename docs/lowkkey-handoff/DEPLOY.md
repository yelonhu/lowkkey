# 生产接入

客户登录与 AI 授权的新部署请先读 [账户与 AI 授权手册](../account-ai-rollout.md)。下文 workers.dev 部分记录既有 Access 测试环境；客户模式不沿用整站 Access 登录墙。

## GitHub 驱动的 workers.dev 测试环境

测试 Worker 使用仓库根目录的 `wrangler.json`，部署名称为 `lowkkey-preview`。D1 与 KV 的绑定 ID、应用地址和 Access AUD 固定在这份配置中；Wrangler 登录凭据不属于仓库。`wrangler.local.json` 专供本地开发，由 Vite 在启动开发服务时显式选择。

把已存在的 Worker 接到 GitHub：Cloudflare **Workers & Pages → lowkkey-preview → Settings → Builds → Connect**，选择 `yelonhu/lowkkey`，根目录为仓库根目录，生产分支为 `main`。构建版本由 `.node-version` 固定为 Node 24.21.0。设置如下：

| 项目 | 值 |
| --- | --- |
| Build command | `npm run build:preview` |
| Deploy command | `npm run deploy:preview` |

不要采用默认的 `wrangler deploy`：前端和 Worker 必须先由 Vite 构建，且生成的配置位于 `.artifacts/build/lowkkey_preview/wrangler.json`。连接时核对目标 Worker 是 `lowkkey-preview`；其他分支的 Preview 部署应等独立的测试 D1/KV 准备好后再启用。Cloudflare 的自动依赖安装使用仓库 `package-lock.json`。

每次推送 `main` 前在本地运行 `./scripts/run check`、`./scripts/run test` 和 `./scripts/run test:e2e`。如果改动包含新的 SQL 迁移，先在对应测试 D1 上执行：

```sh
npx wrangler d1 migrations apply lowkkey-preview --remote --config wrangler.json
```

随后提交并推送代码；Cloudflare Builds 从 GitHub 检出提交、构建并部署。普通代码部署不会重建 D1/KV，也不会迁移本地 `.data/`。紧急手动部署使用相同的 `build:preview` 和 `deploy:preview` 命令，再把对应代码提交到 GitHub，避免云端版本与仓库分叉。

当前 Worker 的 Access 全流量策略适合网页验收。实际连接远程 MCP 前，应给 `/.well-known/*`、`/oauth/*` 和 `/mcp` 配置精确的边缘绕过路径；`/authorize` 和 `/v1/*` 始终要求 Access 登录。

## 自定义域名生产环境

`wrangler.production.example.jsonc` 是生产配置模板。生产域名、D1、KV、Google OAuth 与邮件服务就绪后，将模板复制为受版本控制的生产配置，替换域名、资源 ID 和客户登录配置；Access 变量仅在迁移旧账户时需要。业务事实只在 D1；OAuth 授权码、令牌与客户端注册信息在 KV。

客户模式由应用会话保护 `/authorize` 和 `/v1/*`。`/.well-known/*` 与 `/oauth/*` 按 OAuth 标准可达，`/mcp` 验证 OAuth 令牌与 D1 授权。Access 不应拦截客户登录和 AI 发现路径；迁移路径可以单独受 Access 保护。具体配置见账户手册。

```sh
npx wrangler d1 migrations apply lowkkey-production --remote --config wrangler.production.jsonc
LOWKKEY_WRANGLER_CONFIG=wrangler.production.jsonc npx vite build
npx wrangler deploy --config .artifacts/build/lowkkey/wrangler.json
```

部署前在独立测试 D1 运行规则、API、OAuth/MCP 和浏览器测试。生产域名发布和 Claude 官方客户端连接验收须在生产基础设施就绪后进行。
