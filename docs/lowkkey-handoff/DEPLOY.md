# 生产接入

`wrangler.production.example.jsonc` 是生产配置模板。生产域名、D1、KV 和 Access 应用就绪后，将模板复制为受版本控制的生产配置，替换域名、资源 ID 和 Access AUD。业务事实只在 D1；OAuth 授权码、令牌与客户端注册信息在 KV。

Access 在网页与 `/authorize` 上要求用户登录，并将 `Cf-Access-Jwt-Assertion` 交给 Worker。OAuth 客户端不会持有 Access 会话，因此 `/.well-known/*`、`/oauth/*` 和 `/mcp` 需要在 Access 边缘策略中绕过登录；Worker 对 `/mcp` 验证 OAuth 令牌及 D1 中的所有者、权限和撤销状态。不要绕过 `/authorize` 或 `/v1/*`。

```sh
npx wrangler d1 migrations apply lowkkey-production --remote --config wrangler.production.jsonc
LOWKKEY_WRANGLER_CONFIG=wrangler.production.jsonc npx vite build
npx wrangler deploy --config .artifacts/build/lowkkey/wrangler.json
```

部署前在独立测试 D1 运行规则、API、OAuth/MCP 和浏览器测试。生产域名发布和 Claude 官方客户端连接验收须在生产基础设施就绪后进行。
