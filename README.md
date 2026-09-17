# lowkkey

当前审阅入口：[训练修订：填写即记录](docs/M1-training-rows.md)。首页改为整卡导航，训练采用离行自动保存的组行、独立草稿与有来源的智能默认；三语、本地等宽字体和详细验收见审阅记录。原工程基线及后续缺口见 [第0批基线](docs/M1-baseline.md)，回退标签为 `m1-engineering-baseline`。

工程目录：`~/Developer/craft/lowkkey`。当前公共视觉规则见 SPEC §5.5；M1.1 原清透蓝验收保留在 [历史视觉审阅](docs/visual-refresh.md)。

**M0 已完成，M1 按小批次交付。** 当前提供 M1.1 称重快录审阅版：三舱首页、称重/历史/七日趋势、真实保存反馈、10秒新增撤销和三语切换。运行方式和五分钟体验步骤见 [M1.1 试用与验收](docs/M1.1.md)。训练快录已接通，饮食界面按下一批推进；对话仅保留本机文字草稿。

产品行为以 [SPEC.md](SPEC.md) 为准，工程证据见 [M0 验收记录](docs/M0.md)，后端基础及剩余范围见 [M1 实施记录](docs/M1.md)。M1.1 的本地验收不代表整个 M1、完整离线能力或线上部署已验收。

## 本地运行

目前支持 macOS arm64；不需要系统 Node、Docker 或数据库。首次安装需要访问 Node/npm/Playwright 官方下载站。

```sh
./scripts/bootstrap
./scripts/run dev
```

打开 `http://127.0.0.1:5173`。`Ctrl-C` 关闭开发服务器及运行时。Node **24.21.0** 下载和 SHA-256 固定在 bootstrap；依赖由 `package-lock.json` 固定。

```sh
./scripts/run check
./scripts/run test
./scripts/run test:e2e
./scripts/run build
./scripts/run migrate:local
./scripts/run probe:env
./scripts/run verify:bootstrap
./scripts/run verify:secrets
```

`check` 不改源码；迁移只写本地数据；`build` 只写 `.artifacts/build`，不部署。`verify:bootstrap` 验证损坏安装包被拒绝；`verify:secrets` 在没有现有 `.env` 时创建临时合成配置，构建并检查泄漏后清理。`verify:dev` 验证开发服务器启动和退出。`schema:generate` 是显式生成 SQL 的维护命令。部署、备份、恢复入口目前非零退出。

所有入口通过 macOS 文件写入限制执行，工程可写目录仅限当前项目。普通命令另禁止非 loopback 出站网络。工具不支持这些限制时直接失败，没有无隔离回退。某些宿主执行器禁止嵌套 macOS sandbox；应允许外层调用这个受限 launcher，不能绕过 launcher 直接启动工具。

## 配置与数据边界

无需 `.env` 或云端凭据即可使用本地审阅版。需要本地配置时复制 `.env.example` 为 `.env` 并执行 `chmod 600 .env`。空值采用安全默认：development、`http://127.0.0.1:5173`、en、AI mock、邮件 preview。当前本地入口拒绝 staging/production/live 与远程绑定。

仅根目录 `.env` 可存敏感配置；不创建 `.dev.vars` 或环境变体。dotenv 不执行 shell；进程环境使用白名单，不把部署 token 交给 Worker。开发实例不使用已有 Wrangler OAuth 登录；launcher 禁止访问旧 `~/.wrangler`，由锁定 Wrangler 的 XDG 路径处理本项目状态。

- `.toolchain`：固定 Node 与测试浏览器。
- `.cache`、`.local`、`.tmp`、`.logs`：项目内缓存、非敏感状态、临时文件及日志。
- `.data/dev`：本地存储模拟；不包含真实用户或 production 数据。
- `.artifacts`：构建、测试 JSON、截图和合成邮件预览。

`/healthz` 保持公开且不含敏感信息。`/api/v1` 已接入身份与成员鉴权，体重创建/读单条/修改/删除、操作回查和体重撤销，以及邀请激活、档案、目标版本、成员管理和会话退出 API 已实现。缺少有效身份时返回 401；已鉴权但尚未实现的端点返回 404。登录激活、三舱首页、称重和部分偏好界面已接通，其余界面按 M1 分批计划推进。

训练 API 已支持个人动作/别名/器械配置、计划版本与按日生效、周安排投影与日程移动、训练及逐组编辑、暂停/结束/取消、历史查询、版本安全撤销和实际休息声明。只读端点不创建日程或实际组；新增安排明确区分另加、替换模板和覆盖全天。

饮食 API 支持手动餐食与描述草稿、份量、自定义食物、配方历史、常用餐、完整度和版本安全撤销。营养使用原始十进制 basis 一次缩放，未知保持 null，历史快照不随参考变化。`GET /api/v1/artifacts` 只返回三个程序投影，合计不因列表分页而截断。照片上传和自动识别尚未接通。

`GET /api/v1/sync/snapshot` 分页读取完整基线，最后一页给出同步 cursor；`GET /api/v1/sync` 读取完整命令批次，包含墓碑、计划选择与配方历史。本人 IndexedDB 将实体、游标、输入草稿和返回位置分开保存，快照分页完成后原子替换，重复批次不回写旧值。前台拉取协调器支持5秒轮询、后台停止与有界重试；手动依赖队列已接入称重、训练快录及偏好，丢失回执先查询再决定重试。尚无离线应用壳，不承诺断网重新打开网页；完整离线、账户退出保护、照片与正式导出继续在后续批次验收。

`dev` 启动先迁移项目内数据库，再准备一个固定虚构邀请管理员。开发专用 `POST /api/local/session` 仅接受同源空 JSON `{}`，创建 HttpOnly 本地会话；不接受身份或 owner 选择。首次随后通过 `/api/v1/session/activate` 确认显示名、目标、语言和时区。开发身份只存在于测试源码并仅 serve 时载入，正式 build 不包含它。端到端测试使用每次独立的 `.data/e2e/<run-id>`，不操作日常开发数据。稳定的本地恢复代次存放在 `.local/state/restore-epoch`，与 D1 分开。

## 干净环境与文件审计

```sh
./scripts/verify-clean  # 无管理员权限；完整冷安装与工程复验
```

在项目 `.artifacts/clean-room` 创建独立副本，不复制缓存、运行时、依赖、`.env` 或本地数据。首次执行后保留证据；完整重跑请使用新的项目副本。

如需同时收集系统级文件写入证据，在**尚未运行 verify-clean 的新副本**中执行：

```sh
./scripts/audit-env
```

仅 `fs_usage` 请求临时管理员权限；不以 root 运行 bootstrap、npm、浏览器或应用。脚本不安装服务，不修改系统配置。`fs_usage -w` 的编号是线程号，不能当成 PID；必须将项目路径、工具名和观测时间与 launcher 日志相互核对，并检查被拒绝操作及未解析路径。仅凭命令成功、环境变量或截图不能将 VAL-ENV 标为通过。

Vitest 5.0.1 默认会在用户目录创建测试 API token。bootstrap 中的 `scripts/adapt-vitest.mjs` 使用版本和源码 SHA-256 校验，只将该 token 改为进程内随机值；本项目关闭测试 API/UI。升级 Vitest 必须重新审查适配，不能静默沿用补丁。

称重三语浏览器证据与实机验证分开记录；移动设备性能、完整恢复与发布仍待验收。真实模型属于 M2，真实邮件属于 M3，本地手动记录不请求这些提供商。
