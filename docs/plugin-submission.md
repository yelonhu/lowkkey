# lowkkey ChatGPT 插件：提交前准备

状态：本地草稿，未上传、未审核、未发布。个人发布者姓名、正式独立域名、演示视频和审核账户访问仍待确认。不要把本文件视为审核通过记录。

## 草稿与校验

- `plugins/lowkkey/plugin.template.json`：英文基础介绍、中文翻译、5 个正向／3 个反向测试场景。
- `plugins/lowkkey/mcp.template.json`：一个远程 MCP，OAuth DCR，使用现有发现端点。请求 read/write/notes:write；lowkkey 授权页仍让用户独立选择 notes:write，默认不勾选。
- `plugins/lowkkey/skills/lowkkey-start/SKILL.md`：首次使用指引；详细字段以服务器的工具 schema 和 instructions 为准。
- 图标打包时直接复制 `public/icon-512.png`，不另存一份源图。
- 本地支持页 `/support`、条款草稿 `/terms`，沿用 `/privacy`；条款尚未生效，不在登录时要求同意草稿。

运行 `./scripts/run plugin:check` 检查结构、测试数目、OAuth 设置、引用路径及常见秘密字段；它不是 OpenAI 官方审核或完整 JSON Schema 认证。

正式配置准备好后，将 `plugins/lowkkey/config.example.json` 复制到项目私密目录 `.local/config/plugin.json`，填写确认的个人姓名 `publisher`、正式独立 HTTPS 根地址 `origin` 和审核人员可打开的视频链接 `demoVideo`。不要放凭据。

从项目根目录用现有隔离 Node 运行：

```sh
./scripts/fence local .toolchain/node-v24.21.0-darwin-arm64/bin/node scripts/plugin-package.mjs .local/config/plugin.json
```

脚本拒绝空配置、占位域名、IP、localhost、workers.dev 和未知配置字段。只收录 manifest、MCP 配置、指引与既有图标，输出 `.artifacts/lowkkey-plugin.zip`；不会上传。当前配置有缺口，因此本轮只交付模板，不生成貌似可提交的 ZIP。URL 的语法检查不证明所有权、DNS、可用性或审核资格，提交前必须实际验证。

## 提交前关卡

| 事项 | 现状／下一步 |
| --- | --- |
| 个人发布身份 | 待本人确认公开姓名并完成 OpenAI Platform 个人验证；不假定 Google 个人资料名就是发布姓名。 |
| 独立域名 | 待确定。更新 Cloudflare 自定义域名、APP_ORIGIN、Google 回调、OAuth 发现和授权返回路径后再冻结 MCP URL。保留现有 beta，规划旧连接兼容，不能直接替换导致旧令牌失效。 |
| 域名验证 | 在提交门户给出挑战后，按要求托管准确 token；本轮不创建挑战或更改线上路由。 |
| 公开页面 | 支持／条款为本地草稿。发布前确认提供者姓名、生效日、服务范围及条款文本，实际检查官网、支持、隐私、条款无需登录可访问。 |
| 审核登录 | 代码仅 Google 登录，禁用按邮箱静默合并，要求 verified email。尚未验证审阅者能在独立设备无需你的手机确认或验证码完成登录。使用专用 Google 测试身份＋独立 lowkkey 空档案，仅样本数据。若 Google 安全挑战阻止审核，先向平台确认可接受的访问方式；不关 MFA、不加认证后门、不分享个人账户。 |
| MCP 九工具 | read: get_brief/read_notes；write: log_session/log_weight/set_plan/set_profile/curate/delete；read＋notes:write: write_note。不同权限发现数量应不同，不能假定安装即拥有九项。 |
| 工具扫描 | 检查线上 schema、annotations、OAuth scopes 与实际行为；目前写工具标为 destructive，curate 非幂等，需用真实覆盖／删除／版本行为说明。 |
| 真实客户端 | 在正式地址用同一测试账户完成网页安装、首次读取、写入、手机读取、刷新令牌、撤销；独立记录，不以 Playwright mock 代替。 |
| 审核材料 | 执行 manifest 内所有场景并填实际结果，录制演示；测试身份与登录细节仅放门户私密字段，绝不写入插件 ZIP。 |
| 门户元数据 | Productivity 为候选分类，上传时核对实际可用分类；发布国家范围由本人提交前确定，不预设全球开放。 |
| 服务稳定性 | 正式提交前复查限流、告警、备份恢复及错误可见性；本轮无生产改动。 |

## 演示录制脚本与结果记录

所有记录都是专用账户样本；录像中不出现令牌、其他账户资料或登录密码。

1. 介绍 lowkkey；从 ChatGPT 安装，Google 登录，展示独立权限勾选。
2. 执行 P1：读取简报，对照网页，说明返回的代码计算指标。
3. 执行 P2：保存训练和体重，修正一个组，网页确认其余组保留。
4. 执行 P3：保存考试周背景和短计划，展示 next；测试前确认星期一没有冲突。
5. 执行 P4：读取已有笔记后按明确要求追加，展示全文与 revision。普通 write 不允许写笔记。
6. 执行 P5：读取后暂停，在网页修改同日笔记，再提交旧 revision；展示 note_conflict 和重读处理。若客户端无法暂停，在录制中分开演示服务端冲突与实际 AI 恢复，不能伪装成一次自然调用。
7. 执行 N1–N3：笔记内恶意指令不执行、只读连接不写入、其他账户不可访问。
8. 手机打开同一 ChatGPT 账户试读；回 lowkkey 查看，撤销连接并验证后续工具请求失效。

| 验收 | 状态 |
| --- | --- |
| 本地结构／常见秘密模式检查 | 由 `plugin:check` 输出记录；不检查真实身份 |
| P1–P5 官方 ChatGPT 客户端 | 未执行 |
| N1–N3 官方 ChatGPT 客户端 | 未执行 |
| Google 审核账户独立登录 | 未执行 |
| 手机发现／调用 | 未执行 |
| 视频／审核提交／公开发布 | 未执行 |

## 官方依据（2026-10-15 核对）

- [插件打包与 OAuth 配置](https://developers.openai.com/plugins/build/plugins)
- [提交、域名验证、审核材料与更新](https://developers.openai.com/plugins/deploy/submission)
- [远程 MCP 审核要求](https://developers.openai.com/plugins/deploy/app-review)

上架是正式公开分发：先通过检查和审核，再由本人决定发布；批准不意味着所有手机账户与工作区都拥有相同入口。
