# lowkkey

日用 AI 外挂数据底座，与私人训练成果展厅。输入和对话留在 Claude / ChatGPT；lowkkey 保存原话、真实组数据、体重和下次安排，再用确定性代码计算趋势。

应用只有三个业务页面：

- **下次练什么**：按训练日展示动作、重量、组次与教练备注。
- **训练展厅**：四条长期 e1RM 曲线、日期倒序的原话记录和每个动作的最佳组。
- **体重**：按自然日计算的 7 日滚动均线，以及显式设置的目标周增重参考带。

没有现场打卡、计时器、输入表单、审批队列或模型手算。登录与账户管理保留。

## 本地运行

```sh
./scripts/bootstrap
./scripts/run dev
# http://127.0.0.1:5173
```

开发数据使用独立的 `.data/showroom`，仅应用 `db/showroom-migrations`。旧 `.data/v02`、旧迁移文件和现有公网部署均不读写。空账户没有示例数据、默认个人计划或假曲线。

```sh
./scripts/run preview:empty
# http://127.0.0.1:5176 — 独立空账户
./scripts/run preview:rehearsal
# http://127.0.0.1:5178 — 标明测试数据的工具区
```

演练通过本地 OAuth/MCP 客户端写入三周合成数据，未连接真实 AI。工具区支持直接保存训练、体重、计划和读取简报。临时库随服务正常退出清理，生产包不包含演练页面或数据。

## MCP

Remote MCP 使用 `/mcp`，Streamable HTTP 和 OAuth。只有四个工具：

| 工具 | 权限 | 行为 |
|---|---|---|
| `log_session(date, raw_text, sets)` | write | 保存完整原话和有序组数据，按日期覆盖 |
| `log_weight(date, lb)` | write | 保存磅数，按日期覆盖 |
| `set_plan(day, items, notes)` | write | 更新一个训练日；备注省略保留、null 清空 |
| `get_brief()` | read | 最近 30 个训练日期、当前计划、体重均线、身体备注和力量摘要 |

写入立即生效。修正或补充同日训练时，AI 必须重传完整原话与组数据。具体结构、单位语义与示例见 [接口说明](docs/lowkkey-handoff/INTERFACE.md)。

成功写入返回保存的数据及 `view_url`，可直接打开对应日期或训练日。简报包含生成时间、数据覆盖范围和各动作被排除组的原因；页面显示最近成功同步时间，并支持手动刷新和切回刷新。

三张业务表为 `training_sessions`、`weights`、`plans`。账户和授权使用独立基础表。e1RM、均线和参考带在共享领域包现算，不作为事实存储。

## 验证

```sh
./scripts/run check
./scripts/run test
./scripts/run build
./scripts/run test:e2e
./scripts/run test:oauth
```

API、账户与 OAuth 测试使用临时 D1；浏览器测试分别启动 Chromium / WebKit 的独立本地 HTTPS 服务，检查三屏、空状态、MCP 写入、焦点刷新、长文本和 320–768px 布局。截图在 `.artifacts/playwright/{chromium,webkit}/showroom-*.png`。

字体、留白和色阶来自 [原设计画板](docs/lowkkey-handoff/frontend/lowkkey-frontend.html)，应用通过 React 与 SVG 直接渲染；不再导入原型 HTML 或使用 DOM 绑定定位。

默认构建使用本地隔离配置，不绑定旧公网库。Google 邀请登录、独立内测部署、密钥配置和 AI 接入步骤见 [公网内测说明](docs/showroom-beta.md)。本地自动化与官方客户端／iPhone 真机验收分别记录。
