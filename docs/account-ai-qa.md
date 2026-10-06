# 账户与 AI 授权验收记录

日期：2026-10-05 复验。环境：本地 macOS，Node 24.21.0，隔离 Miniflare D1/KV。

## 已执行

| 检查 | 结果 |
| --- | --- |
| TypeScript + 全仓 ESLint | 通过 |
| 规则、API、客户认证 | 52 项通过 |
| Chromium / WebKit | 78 项通过 |
| 本地 OAuth / Streamable HTTP MCP | 通过 |
| MCP 输入、输出、权限 Schema 与生成文档一致性 | 通过 |
| Vite 生产构建 | 通过；公网验收与本地结果分开记录 |
| 原交接 HTML | Git diff 为空 |

认证覆盖邀请拒绝、验证码一次性使用/过期、邮件失败、不同账户写入拒绝、其他设备退出、邀请撤销和同源检查。浏览器覆盖并发未登录请求的取消竞态、退出清屏、指定第二个批次并刷新、用户专属确认、失败重试、训练和独立演练。卡片测试使用模拟 MCP Apps 宿主，不连接官方客户端。

测试曾发现首次未登录并发请求被取消后误显示网络失败；修正取消原因后重新完整运行。没有用忽略或重试失败测试来替代修复。

10 月 5 日复验发现 6 项浏览器训练失败：设备捕获日期与账户日期不同，补录场次按日期排序遮住了实际进行中的训练。已按显式开始事件时间识别当前训练，完成页按结束时间选择总结；新增确定性的跨日期回归用例后，52 项规则/API/认证、78 项浏览器及 OAuth/MCP 全部重新通过。

公网增量迁移 `0003_customer_auth.sql` 已成功应用，发布前恢复点已保存。当前公网配置继续使用 Access，尚无 Google/Resend 登录密钥。用户验证步骤见 `public-preview-checklist.md`。

十屏截图位于 `.artifacts/playwright/{chromium,webkit}/v1-*.png`。独立演练截图为 `rehearsal-main.png`、`rehearsal-review.png`、`rehearsal-progress.png`。这些账户数据仅存在于隔离测试数据库。

## 尚未验收

- Google 实际身份提供商回调与真实邮件送达（缺域名/凭据）。
- 旧 Access 账户在公网的双重身份认领（需要旧 Access 配置与新客户会话同时可用）。
- Claude、ChatGPT 官方连接和 MCP Apps 官方宿主。
- iPhone Safari 与主屏幕真机：设备、系统版本待记录。
- GitHub Actions Linux 首跑、main 分支必需检查、Cloudflare 真实发布 SHA。

这些项目不因本地通过而标为完成。上线步骤和回滚边界见 `account-ai-rollout.md`。
