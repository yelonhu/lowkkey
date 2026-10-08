# 公网内测：Google 登录与四工具 MCP

本环境使用独立的 `lowkkey-showroom-beta` Worker、D1 和 OAuth KV。三张业务表从空库开始；不迁移或修改旧 `lowkkey-preview` 数据。业务写入只经 MCP，网页读取同一账户的事实。

## 首次发布

所有命令在项目根目录运行。`scripts/release` 使用现有 Node 和依赖，凭据、日志与缓存留在项目中；只有此发布入口允许外部网络，本地开发仍仅允许 loopback。不要用旧 `wrangler.json` 执行本环境迁移或部署。

```sh
./scripts/release login
./scripts/release whoami
./scripts/release resources
# 仅在资源尚不存在时创建；先检查上一步结果，避免重复创建。
./scripts/release create-d1
./scripts/release create-kv
```

将新资源返回的 ID 填入 `wrangler.showroom-beta.json`；确认账户的 workers.dev 子域与 `APP_ORIGIN` 一致。发布脚本拒绝使用旧数据库或旧授权 KV。

```sh
./scripts/release init-secrets
```

上述命令生成 `.local/config/showroom-beta.secrets.json`，权限为 0600，已被 Git 忽略。`BETTER_AUTH_SECRET` 自动生成；手动填入 Google Web 客户端的 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。再次执行不会覆盖已有密钥。不要把此文件上传到 Git、聊天或 CI 产物。

### Google OAuth 配置

在 Google Cloud Console 为内测创建独立项目及 Google Auth Platform 应用：

- 应用名称：`lowkkey beta`，受众为 External，保持 Testing。
- 支持邮箱、开发者联系邮箱和首位测试用户：`yelon.hu@gmail.com`。
- 仅申请 `openid`、`email`、`profile`。
- 创建 **Web application** 客户端。
- Authorized JavaScript origin：`https://lowkkey-showroom-beta.yelon-hu.workers.dev`。
- Authorized redirect URI：`https://lowkkey-showroom-beta.yelon-hu.workers.dev/api/auth/callback/google`。

如果最终 Cloudflare 子域不同，应先同步修改 `APP_ORIGIN` 和以上两个地址。不要将 `/authorize` 或 `/oauth/token` 填为 Google 回调；它们用于 AI 客户端连接 lowkkey。

```sh
./scripts/release migrate
./scripts/release invite yelon.hu@gmail.com
./scripts/run check
./scripts/run test
./scripts/run build
./scripts/run test:e2e
./scripts/run test:oauth
```

提交并推送当前分支，等待 GitHub Product checks 成功。本轮不合并 main。GitHub 工作流只检查，不自动部署。

```sh
./scripts/release deploy
./scripts/release status
```

部署前必须是干净的 Git 工作区且三项秘密配置齐全。发布命令重新构建正确环境，上传秘密配置并以提交号标记版本。`/healthz` 返回的 version 应等于 `git rev-parse HEAD`。若需要回滚应用代码，选定已验证提交，在保持相同新库的前提下重新构建并发布；不倒退数据库迁移，不触碰旧环境。

## AI 连接

MCP 地址为应用域名下的 `/mcp`，使用 Streamable HTTP + OAuth。配置自定义连接器后，以受邀 Google 账户登录并选择 `read` / `write`。首次授权时确认当前账户邮箱；授权后所有工具都绑定该账户，与网页和其他 AI 对话共享同一份事实。

- Claude：在 Connectors 中添加远程自定义连接器，填入 `/mcp` 地址，使用 OAuth 发现的配置。
- ChatGPT：在 Plugins 中添加自定义 MCP server，填入同一地址并安装到个人账户或工作区；可用性受账户及工作区权限约束。
- 全权限恰好四个工具；只读授权只提供 `get_brief`。无需增加 `search`、`fetch` 或审批工具。
- 工具写入直接生效；AI 客户端自身可能要求确认，lowkkey 不添加第二层业务审批。
- 在 lowkkey 账户面板撤销某个连接后，该连接的访问和刷新令牌都不能继续访问数据。

参考：[Claude 自定义连接器](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)、[ChatGPT 自定义 MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server)。

建议首条提示：

> 请先调用 lowkkey 的 get_brief 读取已有事实。保存训练时保留我的原话、换行和重量单位；不猜测缺失信息。修改同一天须提交完整原话与全部组。力量和体重趋势引用工具返回的代码计算值。保存成功后给我查看链接。

## 验收记录

- 自动化：领域、账户/API、Chromium/WebKit 三屏与深链接、OAuth 四工具、真实 Better Auth 会话 → OAuth → MCP → 同账户网页 → 撤销。账户集成测试只截获本地验证码投递；OAuth/MCP 在实际 Workers 运行时执行。
- 自动化不能替代：真实 Google 登录、Claude/ChatGPT 官方客户端、iPhone Safari 真机回跳和跨应用刷新。
- 首次登录必须为空。只将用户提供的真实记录写入其内测账户；合成演练数据保留在临时测试库。
- 手机检查字体、留白、长计划、长原话、图表、320px 布局及底部最近同步时间。AI 返回的链接应打开对应训练日／计划日／体重日期。
- 发布结果应记录实际 URL、提交号、Cloudflare 版本及以上人工验收结果；未执行的项目保持“未验收”。
