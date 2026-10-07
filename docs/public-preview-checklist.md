# 公网预览验收

## 本次发布边界

本次更新现有 `lowkkey-preview.yelon-hu.workers.dev`，继续使用 Cloudflare Access 登录。Google、邮箱验证码、客户账户迁移和真实 AI 连接，须完成 `account-ai-rollout.md` 中的外部配置后另行验收。

2026-10-05 已应用增量迁移 `0003_customer_auth.sql`。没有导入本地测试记录；已有业务条目保留。发布前 Worker 版本为 `05811396-b687-4da5-ace6-ca39ca9ed51b`，数据库恢复点保存在本机 `.artifacts/releases/2026-10-05/pre-deploy.json`。

## iPhone 本轮复测

2026-10-06 前端修复的四项真机清单见 [iPhone 状态舱验收](iphone-chamber-qa.md)。本轮没有数据库迁移或认证切换。真机仍待验证，自动化通过不等于 iPhone 已通过。

## 你可以立即验证

1. 在已登录的浏览器打开 `https://lowkkey-preview.yelon-hu.workers.dev/healthz`。应显示 `status: ok`，`version` 应等于 GitHub main 最新提交的完整 SHA。
2. GitHub 仓库 → Actions → Product checks：检查该提交是否全绿。Cloudflare → lowkkey-preview → Deployments：确认当前版本来自同一提交，构建和部署都成功。仅 Git push 成功不能证明部署完成。
3. iPhone Safari 打开首页：已有数据正常显示，原记录没有丢失。退出后重新进入应要求有效身份。无痕窗口不能直接读取 `/v1/state`。
4. 输入一条**真实**称重或训练记录，确认今日、体征/进步及日志同步更新；刷新页面后仍在。不需要为了测试在个人账户编造数字。若记录有误，在日志撤销，检查图表相应恢复。
5. 已有计划时走一遍开始训练、记录一组、返回今日、继续训练、结束；完成页应只总结本场。没有计划的账户跳过此项，完整演练用本地隔离入口。
6. 在 Safari 和添加到主屏幕后分别试：中文输入、键盘收起、切页、长列表滚动、抽屉开关、系统“减弱动态效果”。顶栏/底栏不能随页面被拖走，键盘关闭后不能留下空白。
7. 断网输入后恢复网络，或快速重复点按提交：记录最终只出现一次，失败时文字仍保留。不要在状态未明时反复重新填写同一条记录。

反馈时附：iPhone 型号、iOS 版本、Safari/主屏幕模式、操作步骤、期望/实际结果，以及 `/healthz` 的 version；异常动效可附屏幕录制。不要发送验证码、Cookie 或令牌。

## 外部登录与 AI 验收

先准备 HTTPS 客户域名、Google OAuth 凭据及回调地址、Resend 发信域名和密钥、受邀邮箱；配置步骤见 `account-ai-rollout.md`。当前预览的 Access 全站登录墙不能直接作为远程 MCP 客户端的完成状态。

配置完成后，使用独立受邀测试账户：Google/邮箱登录 → Claude 授权 → 读取状态 → 提交计划 → 网页确认 → 五条训练记录一次确认 → AI 回读已接受结果 → 撤销记录 → 撤销客户端授权。撤销后原客户端的读取与刷新授权均应失败。ChatGPT 使用确实支持自定义连接的账户重复验证。

## 回滚

应用异常时，在 Cloudflare Deployments 选择上一版本回滚。新增认证表保留，不执行反向删除迁移，也不回滚账本来删除发布后的真实记录。数据库恢复只用于明确的数据事故，不能代替普通应用回滚。
