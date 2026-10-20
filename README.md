# lowkkey v5

私人训练档案。可在随手记自由记录，或在 Claude / ChatGPT 对话；lowkkey 保存训练事实、体重、计划与策展，所有数字由共享领域代码计算。

五页为 `#next`、`#recap`、`#body`、`#log`、`#notes`。React 与 SVG 直接渲染；随手记按账户时区每天分段、今天在底部，纯文字自动保存。网页是一个「状态舱」：AI 每周选的主题在页面顶部形成一层天光，品牌后的句点像心跳一样呼吸、同步时加快；AI 写的每段文字前有同一枚墨点，用户原话用「」。next 页顶部一行状态（今天、第几周、本周完成/计划、最新体重）；首次到达每页时内容依次浮现，按压即刻回应，顶部下拉同步，手机上的设置是从底部升起的纸。点击 `lowkkey` 品牌进入设置，没有训练表单、计时器或审批。

## 运行与验证

```sh
./scripts/bootstrap
./scripts/run dev
./scripts/run preview:empty
./scripts/run preview:rehearsal
./scripts/run check
./scripts/run protocol:emit
./scripts/run test
./scripts/run build
./scripts/run test:e2e
./scripts/run test:oauth
```

开发服务使用独立 `.data/showroom`，迁移入口 `db/showroom-migrations`；旧 `db/migrations` 和旧公网库不参与。演练只写入临时 D1 的合成数据，生产包没有示例数据。私密原稿与备份不进 Git；本地原稿验收使用 `.local/v5/reference-facts.json`，CI 自动跳过这项私人数据测试。

## 九工具 MCP

地址为应用域名下的 `/mcp`，使用 Streamable HTTP + OAuth。全权限九项，只读提供 `get_brief` 和 `read_notes`。

| 工具 | 参数与行为 |
|---|---|
| `log_session` | `date/title/sets/note`，整体覆盖当日；note 只保存用户的话，拒绝 raw_text |
| `log_weight` | `date/lb`，按日期覆盖 |
| `set_plan` | `title/weekday/items/coach`，同星期唯一，空 items 删除 |
| `set_profile` | 目标和身体备注，省略保留、null 清空 |
| `curate` | 周主题、周信、picks、next/body 与 log 批注；递归 patch，每次保存版本 |
| `delete` | `kind/date`，返回删除的训练或体重 |
| `get_brief` | 默认六次训练，可选 0–30；紧凑组、计划、领域读数、week_facts 与四周策展摘要 |
| `read_notes` | 单日（包含空记录版本）或范围分页，默认 14 个非空日期、最多 30，不截断 |
| `write_note` | `date/text/revision`，独立 `notes:write` 权限；仅按用户明确要求提交整日原文 |

`get_brief` 同时返回 `guide`：`stage`（empty / setup / active）、`missing`（档案还缺什么：训练背景、计划、next 提示、训练、体重、本周周信、体重批注）、`next_step` 与 `week`（本周第几周、完成几次、计划几次），全部由已保存事实和实际权限推导。MCP instructions 是一本「管理者手册」：身份、页面地图（哪个工具画哪一页）、读写边界三档、首次会话剧本和日常例程。另提供三个 prompts：`start`、`log_today`、`weekly_letter`，把管理者角色放进用户自己的消息里。

写入立即生效，返回保存对象和 `view_url`。同日修正须重传完整组数据。输入先验证，D1 原子批次及版本比较防止并发 patch 丢失。网页通过独立接口编辑随手记，AI 写随手记需单独授权一次（`notes:write`，同时需要 `read`）；旧读写连接仍为八工具。默认保留原文后追加，只有明确要求才改写或清空。随手记有独立日期版本；冲突保留两份供用户选择，断网草稿按账户暂存本机，同步后移除。导出和注销覆盖随手记。

[协议说明](docs/lowkkey-handoff/INTERFACE.md) · [设计实现](docs/lowkkey-handoff/DESIGN.md) · [beta 发布与迁移](docs/showroom-beta.md)

## 首次使用与账户

欢迎 → Google 登录 → `#start` 连接 AI，或选择“先随手记”。Google 开放注册，无需邀请；账户设置支持时区、连接撤销、导出与注销。仅支持 Google 登录。详见 [产品化与发布说明](docs/productization.md)。
