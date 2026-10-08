# lowkkey

lowkkey 是一个记录训练与体征变化的个人状态舱。它把训练组、体重和已确认的动作安排放在同一份账本里，用可追溯的规则计算趋势与训练进步。

- **轻松记录**：用一句话或训练中的快捷操作记下真实发生的事。
- **看懂变化**：查看体重趋势、力量进步和每周训练量；每个计算结果都能追溯到公式与原始记录。
- **自己做决定**：模型可以提交待审草稿和建议，最终确认、调整计划与撤销记录由用户完成。

记录采用只追加事件日志：修改通过追加新事件表达，已有记录保留出处。

## 设计与实现

`docs/lowkkey-handoff` 保留设计与协议说明。运行界面读取其中的 [前端 HTML](docs/lowkkey-handoff/frontend/lowkkey-frontend.html)、内联样式与 SVG，再通过运行时绑定、结构整理及响应式样式接入本人 D1 账本及 V1–V10 规则派生值。缺数据时显示真实空状态；交接包中的示例事实不进入运行账户。当前发布状态及未完成验收统一见 [公网预览验收](docs/public-preview-checklist.md)。

应用内标准文字由确定性解析器处理。网页不调用付费模型。外部客户端经 OAuth 连接 `/mcp`，可读取本人状态、提交待审批次或提出动作安排建议。模型草稿在用户完成批量审阅并一次确认前不入账；撤销和所有决策只属于通过网页身份验证的用户。D1 条目及 ID 保留，撤销追加 `revert`。

## 本地运行

```sh
./scripts/bootstrap
./scripts/run dev
```

打开 `http://127.0.0.1:5173`。开发登录使用本机测试身份，不读取旧库或实验 JSON。直接打开 `index.html` 的 `file://` 页面只显示启动说明。

首页显示已确认的动作安排、最近记录及待审事项。外部 AI 提交的安排经用户审阅后生效；没有安排也可选择目录中的动作自由训练或快速记录体重。首次无重量依据时需要输入重量，提交按钮直接显示实际重量、单位和次数，无额外单位确认。后续重量优先沿用实际记录；与实际记录不同的已确认安排须主动采用，不因次数或 RIR 自动加减重量。体征、进步和日志随本人状态刷新。

客户界面不显示协议工具表或端点地址。邀请制 Google / 邮箱验证码、会话管理与 AI 授权已有代码和隔离测试；公网客户登录配置、官方 AI 客户端实连和 iPhone 真机验收仍待完成。

### 空账户与独立演练

```sh
npm run preview:empty
# http://127.0.0.1:5176 — 全新空账户
```

另开终端运行：

```sh
npm run preview:rehearsal
# http://127.0.0.1:5178 — 演练工具区，内嵌 5179 上的正式页面
```

这两个入口均创建独立临时 D1，正常退出时删除各自数据库，不触碰 `.data/v02`、个人或公网账户。演练工具明确标注测试数据，通过一个名为“演练客户端（非真实 AI）”的本地 OAuth 客户端调用既有 MCP；没有连接真实 Claude。测试数据、工具页面及模拟操作只在独立 Node 开发脚本中，生产构建不包含它们。

演练步骤：查看当前计划 → 工具区点“模拟 AI 提交计划调整” → 页面点“查看并确认”，比较修改前后并“采用” → 工具区点“模拟 AI 提交 5 条记录” → 页面一次确认 → 查看体征、进步、日志 → 在日志撤销一条记录。重复点击同一模拟操作复用幂等请求；开始另一轮请点“重置演练”。也可在连接页撤销演练客户端授权，此后模拟提交应失败。演练重置会重新建立测试授权。


## 验证

```sh
./scripts/run check
./scripts/run test
./scripts/run build
./scripts/run test:e2e
./scripts/run test:oauth
```

API、Playwright 与 OAuth/MCP 端到端测试需要可监听本机 loopback 的环境。Playwright 为 Chromium 和 WebKit 分别启动隔离 D1 与本地 HTTPS（需要 OpenSSL）；`test:oauth` 自动管理其隔离服务。十屏截图输出在 `.artifacts/playwright/{chromium,webkit}/v1-*.png`。当前待验收项见 [公网预览验收](docs/public-preview-checklist.md)，以往检查证据见 [历史交互验收记录](docs/interaction-qa.md)。

交接 HTML 保持原样；[绑定定位清单](src/app/binding-hooks.json) 为原节点标记绑定入口。运行时增加真实输入控件、调整布局，并通过稳定节点更新保留输入、焦点和滚动位置。

## 接口与部署

- 网页通过配置的 Access 或客户会话身份调用 `/v1`，当前公网预览仍使用 Access。所有业务写入携带 `Idempotency-Key`；捕获同时固定 `capturedAt`、`capturedLocalDate` 和 IANA `timeZone`。
- Remote MCP 在 `/mcp` 使用 Streamable HTTP 与 OAuth 授权码流程，权限为 `read`、`submit`、`propose`。`propose_entries` 只提交待审草稿。
- REST、实体和 MCP 工具契约见 [INTERFACE.md](docs/lowkkey-handoff/INTERFACE.md) 与 [protocol](docs/lowkkey-handoff/protocol)。
- 生产配置模板见 [DEPLOY.md](docs/lowkkey-handoff/DEPLOY.md)。现有 workers.dev 预览已部署；客户登录与远程 MCP 的路由配置要求见 [账户与 AI 授权手册](docs/account-ai-rollout.md)。官方 Claude/ChatGPT 客户端尚未完成公网验收。

## 客户登录与 AI 授权

邀请制 Google / 邮箱验证码、OAuth/MCP、部署前置条件及回滚说明见 [账户与 AI 授权手册](docs/account-ai-rollout.md)。公网官方客户端与 iPhone 验收和隔离自动化测试分别记录。
