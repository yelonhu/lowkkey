# lowkkey v5

私人训练档案。可在随手记自由记录，或在 Claude / ChatGPT 对话；lowkkey 保存训练事实、体重、计划与策展，所有数字由共享领域代码计算。

五页为 `#next`、`#recap`、`#body`、`#log`、`#notes`。React 与 SVG 直接渲染，原有四页延续 v5 原稿和只读展厅；新增随手记按账户时区每天分段、今天在底部，纯文字自动保存，正文采用系统字体。共享三套深浅主题。点击 `lowkkey` 品牌进入设置，没有训练表单、计时器或审批。

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

## 八工具 MCP

地址为应用域名下的 `/mcp`，使用 Streamable HTTP + OAuth。全权限八项，只读提供 `get_brief` 和 `read_notes`。

| 工具 | 参数与行为 |
|---|---|
| `log_session` | `date/title/sets/note`，整体覆盖当日；note 只保存用户的话，拒绝 raw_text |
| `log_weight` | `date/lb`，按日期覆盖 |
| `set_plan` | `title/weekday/items/coach`，同星期唯一，空 items 删除 |
| `set_profile` | 目标和身体备注，省略保留、null 清空 |
| `curate` | 周主题、周信、picks、next/body 与 log 批注；递归 patch，每次保存版本 |
| `delete` | `kind/date`，返回删除的训练或体重 |
| `get_brief` | 默认六次训练，可选 0–30；紧凑组、计划、领域读数、week_facts 与四周策展摘要 |
| `read_notes` | 已同步原文；日期范围、倒序分页，默认 14 个日期、最多 30，不静默截断 |

写入立即生效，返回保存对象和 `view_url`。同日修正须重传完整组数据。输入先验证，D1 原子批次及版本比较防止并发 patch 丢失。网页通过独立接口编辑随手记，AI 不能修改或删除原文。随手记有独立日期版本；冲突保留两份供用户选择，断网草稿按账户暂存本机，同步后移除。导出和注销覆盖随手记。

[协议说明](docs/lowkkey-handoff/INTERFACE.md) · [设计实现](docs/lowkkey-handoff/DESIGN.md) · [beta 发布与迁移](docs/showroom-beta.md)

## 首次使用与账户

欢迎 → Google 登录 → `#start` 连接 AI，或选择“先随手记”。Google 开放注册，无需邀请；账户设置支持时区、连接撤销、导出与注销。仅支持 Google 登录。详见 [产品化与发布说明](docs/productization.md)。
