# lowkkey

`docs/lowkkey-handoff` 是新版唯一规格。运行界面直接使用其中的 [前端 HTML](docs/lowkkey-handoff/frontend/lowkkey-frontend.html)、内联样式与 SVG，并将十个画板绑定到本人 D1 账本及 V1–V10 规则派生值。缺数据时显示真实空状态；交接包中的示例事实不进入运行账户。

应用内标准文字由确定性解析器处理。网页不调用付费模型。外部客户端经 OAuth 连接 `/mcp`，可读取本人状态、提交待审批次或提出计划建议。模型草稿在用户完成批量审阅并一次确认前不入账；撤销和所有决策只属于 Access 验证的网页用户。原有 D1 条目及 ID 保留，新版条目只追加，撤销追加 `revert`。

## 本地运行

```sh
./scripts/bootstrap
./scripts/run dev
```

打开 `http://127.0.0.1:5173`。开发登录使用本机测试身份，不读取旧库或实验 JSON。直接打开 `index.html` 的 `file://` 页面只显示启动说明。

## 验证

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
./node_modules/.bin/playwright test
node tests/oauth-mcp.e2e.mjs
```

API、Playwright 与 OAuth/MCP 端到端测试需要可监听本机 loopback 的环境。Playwright 启动隔离 D1；手动运行 OAuth/MCP 测试前先启动 `node scripts/serve.mjs --e2e`。十屏截图输出在 `.artifacts/playwright/v1-*.png`。

## 接口与部署

- 网页通过 Cloudflare Access 调用 `/v1`。所有业务写入携带 `Idempotency-Key`；捕获同时固定 `capturedAt`、`capturedLocalDate` 和 IANA `timeZone`。
- Remote MCP 在 `/mcp` 使用 Streamable HTTP 与 OAuth 授权码流程，权限为 `read`、`submit`、`propose`。`propose_entries` 只提交待审草稿。
- REST、实体和 MCP 工具契约见 [INTERFACE.md](docs/lowkkey-handoff/INTERFACE.md) 与 [protocol](docs/lowkkey-handoff/protocol)。
- 生产配置模板与 Access 路由要求见 [DEPLOY.md](docs/lowkkey-handoff/DEPLOY.md)。实际公网部署及 Claude 官方客户端验收留待生产域名、D1、KV 和 Access 配置就绪后执行。
