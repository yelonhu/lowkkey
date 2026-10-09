# lowkkey v5

私人训练档案。输入与对话留在 Claude / ChatGPT；lowkkey 保存训练事实、体重、计划与策展，所有数字由共享领域代码计算。

四页为 `#next`、`#recap`、`#body`、`#log`。React 与 SVG 直接渲染，视觉采用用户确认的 v5 HTML 原稿：Inter / 宋体、三套深浅主题、留白和器械图。点击原位置的 `lowkkey` 品牌进入设置；四页没有现场输入、计时器或审批。

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

## 七工具 MCP

地址为应用域名下的 `/mcp`，使用 Streamable HTTP + OAuth。全权限严格七项，只读只提供 `get_brief`。

| 工具 | 参数与行为 |
|---|---|
| `log_session` | `date/title/sets/note`，整体覆盖当日；note 只保存用户的话，拒绝 raw_text |
| `log_weight` | `date/lb`，按日期覆盖 |
| `set_plan` | `title/weekday/items/coach`，同星期唯一，空 items 删除 |
| `set_profile` | 目标和身体备注，省略保留、null 清空 |
| `curate` | 周主题、周信、picks、next/body 与 log 批注；递归 patch，每次保存版本 |
| `delete` | `kind/date`，返回删除的训练或体重 |
| `get_brief` | 默认六次训练，可选 0–30；紧凑组、计划、领域读数、week_facts 与四周策展摘要 |

写入立即生效，返回保存对象和 `view_url`。同日修正须重传完整组数据。输入先验证，D1 原子批次及版本比较防止并发 patch 丢失。网页只增加主题偏好写入接口，其余业务输入仍由 AI 完成。

[协议说明](docs/lowkkey-handoff/INTERFACE.md) · [设计实现](docs/lowkkey-handoff/DESIGN.md) · [beta 发布与迁移](docs/showroom-beta.md)
