# 独立展厅环境配置

本次重构只进行本地验证，没有发布公网。不得将新迁移应用到旧事件账本数据库。

## 本地隔离

- wrangler.local.json：新 showroom 数据库标识，migrations_dir 为 db/showroom-migrations。
- scripts/local-runtime.mjs / Vite：默认 .data/showroom。
- 测试和演练：每次新建 .data/e2e-showroom 下的临时目录，退出清理。
- 旧 .data/v02 与 db/migrations 保持原样。
- 默认 build 使用本地配置。wrangler.json 是旧公网配置，不用于新版本默认构建；原 deploy:preview 捷径已移除。

## 未来公网环境

需要显式建立新的 D1 和 OAuth KV，复制 wrangler.production.example.jsonc 为独立配置，填入新绑定、新域名及 APP_ORIGIN。新库只应用 db/showroom-migrations；旧公网资源不复用。正式发布另行进行。

客户登录继续支持邀请制 Google 和邮箱验证码。环境需配置 AUTH_MODE=customer、BETTER_AUTH_SECRET、APP_ORIGIN；Google 使用 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET；邮箱使用 RESEND_API_KEY / AUTH_EMAIL_FROM。启用 AI 连接入口需 AI_CONNECTION_ENABLED=1 与 HTTPS。

允许连接的路由包含 /api/*、/v1/*、/mcp、/.well-known/*、/authorize、/oauth/*。OAuth 使用 read / write 两种权限，并在同意页明确直接写入及同日覆盖。用户在账户面板撤销授权后，访问与刷新令牌均不得再使用。

邀请管理继续使用 scripts/invite.mjs。--local 默认使用 .data/showroom；必须传入对应的新环境配置。撤销邀请同时撤销客户会话与 oauth_clients 授权。

## 验证边界

本地测试覆盖 OTP、账户隔离、OAuth PKCE、四工具契约、直接写入、读取权限、撤销和 Chromium / WebKit 三屏流程。官方 Claude / ChatGPT 公网实连及 iPhone 真机验收仍需在正式配置后进行，不以本地演练替代。
