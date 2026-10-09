# 公网内测：Google 登录与七工具 MCP

本环境使用独立的 `lowkkey-showroom-beta` Worker、D1 和 OAuth KV。三张业务表从空库开始；不迁移或修改旧 `lowkkey-preview` 数据。业务写入只经 MCP，网页读取同一账户的事实并可保存主题偏好。

2026-10-08 已创建独立 D1 `lowkkey-showroom-beta`、KV `lowkkey-showroom-beta-oauth`，并完成新库迁移与首位邮箱邀请。Google 项目为 `formal-purpose-511022-e7`（显示名称 `lowkkey beta`），Web 客户端为 `lowkkey showroom beta`；凭据仅存于项目私密配置。Cloudflare 子域已核对为 `yelon-hu`。这些配置完成不等于正式客户端或手机验收通过，验收按文末清单分别记录。

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

部署前必须是干净的 Git 工作区且三项秘密配置齐全。发布命令重新构建正确环境，上传秘密配置并以提交号标记版本。`/healthz` 返回的 version 应等于 `git rev-parse HEAD`。v5 是协议与数据升级，不能直接部署 v4 Worker 回滚。遵循下方迁移回滚说明，不触碰旧 lowkkey-preview 环境。

## AI 连接

MCP 地址为应用域名下的 `/mcp`，使用 Streamable HTTP + OAuth。配置自定义连接器后，以受邀 Google 账户登录并选择 `read` / `write`。首次授权时确认当前账户邮箱；授权后所有工具都绑定该账户，与网页和其他 AI 对话共享同一份事实。

- Claude：在 Connectors 中添加远程自定义连接器，填入 `/mcp` 地址，使用 OAuth 发现的配置。
- ChatGPT：在 Plugins 中添加自定义 MCP server，填入同一地址并安装到个人账户或工作区；可用性受账户及工作区权限约束。
- 全权限恰好七个工具；只读授权只提供 `get_brief`。无需增加 `search`、`fetch` 或审批工具。
- 工具写入直接生效；AI 客户端自身可能要求确认，lowkkey 不添加第二层业务审批。
- 在 lowkkey「设置」中撤销某个连接后，该连接的访问和刷新令牌都不能继续访问数据。

参考：[Claude 自定义连接器](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)、[ChatGPT 自定义 MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server)。

建议首条提示：

> 请先调用 lowkkey 的 get_brief 读取已有事实。保存训练时 note 只放我说的话，使用正确重量单位；不猜测缺失信息。修改同一天须提交全部组，你的批注用 curate。力量和体重趋势引用工具返回的代码计算值。保存成功后给我查看链接。

## 验收记录

- 自动化：领域、账户/API、Chromium/WebKit 四页与深链接、OAuth 七工具、真实 Better Auth 会话 → OAuth → MCP → 同账户网页 → 撤销。账户集成测试只截获本地验证码投递；OAuth/MCP 在实际 Workers 运行时执行。
- 自动化不能替代：真实 Google 登录、Claude/ChatGPT 官方客户端、iPhone Safari 真机回跳和跨应用刷新。
- 已验收：2026-10-08 beta 首次部署完成，真实 Google 登录、受邀账户和四页空状态通过；用户确认 Claude 连接成功。Claude 的七工具真实数据闭环、ChatGPT 连接和手机 Safari 真机检查仍分别待验收，连接成功不等于全部工具已实测。
- 首次登录必须为空。只将用户提供的真实记录写入其内测账户；合成演练数据保留在临时测试库。
- 手机检查字体、留白、长计划、长原话、图表、320px 布局及设置里的最近同步时间。AI 返回的链接应打开对应训练日／计划日／体重日期。
- 发布结果应记录实际 URL、提交号、Cloudflare 版本及以上人工验收结果；未执行的项目保持“未验收”。


## v5 的一次性升级

先完成全部检查、推送当前分支并通过 CI，再切换现有 beta。完整 HTML 只从用户提供的私密路径读取；导入脚本用 TypeScript AST 读取四个数据常量，不运行 HTML。备份与导入文件权限 0600，全部位于被忽略的 `.local/v5`。

1. `./scripts/release backup-v5`：导出完整 beta D1，并核对账户、日期数量及计划星期映射。已有四个中文带星期的计划标题明确映射为原稿单字标题。
2. `./scripts/release migrate`：只新增 0001_v5。迁移先阻止 v4 事实写入，再复制数据，保留 legacy 表供回滚；此窗口 v4 写入会报重试。
3. `./scripts/release import-v5 PRIVATE_HTML EMAIL`：严格核验 16 次/252 组/23 次/4 计划后，只向指定唯一账户写入；相同日期覆盖，其他日期保留。目标按原稿导入，已有身体备注保留。策展保留历史周和带日期的 next/body；计划历史从实际导入日起生效。导入命令逐字段读回验证，写出私密证明；此时 v4 仍被写锁保护，不与回填交错。
4. `./scripts/release deploy`：回填核验成功后切换七工具 Worker 与四页应用，OAuth KV 和 Google 身份不变。
5. 确认网页、MCP 和健康版本后，`./scripts/release retire-v4` 再导出一份完整备份，退役 legacy 三表及 raw_text。

回滚：切换 Worker **之前** 可执行 `db/showroom-release/rollback-before-cutover.sql`，删除新克隆并解除 legacy 写锁，保留所有旧事实；本地迁移测试验证此路径。切换 **之后** 已可能产生 v5 新数据，应保留 v5 架构并修复代码；必须降级时，先备份当前库，在新的恢复 D1 中还原私密 SQL 并验证账户/数据，再显式切换绑定。不能把旧备份直接覆盖有新写入的活跃数据库。退役 SQL 不在自动迁移目录，只有导入核验成功才允许执行。

自动化覆盖迁移回滚、原子导入、重复日期、保留其他账户、策展版本、删除、主题、只读与撤销。官方 Claude 已由用户确认连接成功；v5 七工具重新发现和 iPhone 真机观感仍需分别验收。
