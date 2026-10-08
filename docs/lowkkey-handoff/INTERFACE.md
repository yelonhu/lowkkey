# lowkkey 展厅协议 · 4.0.0

这是不兼容旧事件账本的独立数据底座。REST 保留 /v1 路径，数据结构以 4.0.0 为准。新库不迁移旧记录。

## 四个 MCP 工具

所有日期为真实存在的 YYYY-MM-DD，本地日期由外部对话明确提供。没有自然语言解析、模型字段推测或审批。未知字段、动作、单位、无效日期均返回错误，不进行部分写入。授权为 read / write；旧 submit / propose 不转换为 write。

### log_session(date, raw_text, sets)

按账户＋日期原子覆盖。重试同一内容不新增记录；修正、补充必须携带该日完整原话及全部组。raw_text 保留原始空白、换行与标点，展示时作为纯文本转义。允许 sets=[]，保留尚无可解析组的原话；不接受空白原话。

```json
{
  "date": "2026-10-08",
  "raw_text": "卧推 100lb×6\n引体辅助 25kg×8",
  "sets": [
    {"exerciseId": "bench_press", "load": 100, "unit": "lb", "loadKind": "external", "reps": 6, "rir": 2, "setRole": "work"},
    {"exerciseId": "pull_up", "load": 25, "unit": "kg", "loadKind": "assist", "reps": 8}
  ]
}
```

sets 有序，每项必须提供 exerciseId / load / unit / loadKind / reps；rir 和 setRole 可选。setRole 为 work / warmup / unknown。动作 ID 及名称列在工具说明中。保留现有通用目录，不提供修改目录或新增动作工具。

- unit 为 lb / kg，保存器械原始读数。
- 哑铃 load 为单只，不乘二。
- 引体与双杠必须显式选择 assist（辅助重量）或 bodyweight（额外负重；徒手为 0）。
- 其他动作使用 external。
- raw_text 最长 20,000 字符；每次最多 250 组。

### log_weight(date, lb)

保存测量日期和正数磅数。同日覆盖，相同数值重试不改变记录。不接受派生值或 kg 字段。

### set_plan(day, items, notes)

day 是稳定的训练日名称；items 完整替换该日安排，空数组清空安排。计划按 day 排序展示，无现场采用操作。

```json
{
  "day": "胸与背",
  "items": [
    {"exerciseId": "bench_press", "load": 115, "unit": "lb", "loadKind": "external", "sets": 3, "repMin": 6, "repMax": 8, "note": "保持肩胛稳定。"}
  ],
  "notes": {
    "coach": "先稳定完成，再考虑加重量。",
    "body": "肩部状态平稳。",
    "gain_target": {"start_date": "2026-10-01", "start_lb": 160, "weekly_lb_min": 0.25, "weekly_lb_max": 0.5}
  }
}
```

items 使用相同重量语义；load=null 表示未安排重量。notes.coach 属于该日；body 和 gain_target 是全局上下文，取最近一次显式写入。任一备注字段省略保留，null 清空。更新别的训练日、仅改教练备注不会恢复旧身体备注或目标。

内部使用账户递增序号记录 body_revision / gain_target_revision；序号生成、可选字段合并和计划写入在同一 D1 事务内完成。无独立备注表、目标表或审批表。

### get_brief()

无参数，一次返回：

- sessions：最近 30 个训练日期，倒序，包含完整原话与全部组。
- plans：全部当前计划，包括已清空动作但仍承载备注的条目。
- latest_weight：最近测量，或 null。
- weight_mean_7d：以最近测量日为截止日期的均值、日期、实际测量日数，或 null。
- body_notes / gain_target：按最近显式写入确定的当前上下文，或 null。
- strength：卧推、深蹲、坐姿哑铃推肩、引体的历史最佳和最近 e1RM；包含日期、原记录中的零起始 set_index、磅数及单只标识。

所有成功工具输出为 structuredContent.result，并带相同内容的文本。引用数字以代码计算结果为准，模型不得重算 e1RM 或均线。缺少依据时返回 null。

## 共享计算

- Epley：1 次取实际有效负荷；2–20 次为 load × (1 + reps/30)。超过 20 次、0 次或非正负荷不估算。明确热身排除；同日同动作以最高值为最佳，并列保留原顺序第一组。
- 自由重量换算到 lb；哑铃保持单只。引体有效负荷＝当日或此前最近体重＋额外负重，或减辅助重量。没有历史体重不计算，不借未来测量。
- 7 日均值：D−6 至 D 的实际日测量算术平均。缺测不填充；空窗口为 null。曲线在空窗口断开。
- 增重带：start_lb + 每周增重上下限 × 距起点天数 / 7。起点之前不绘制，页面延伸至最近测量或目标起点后四周。没有目标不绘制参考带。

## 网页接口

网页通过现有登录会话访问；OAuth token 只用于 /mcp。

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | /v1/state | 当前账户全部三类事实，供长期历史与曲线展示 |
| GET | /v1/account | 当前账户信息 |
| GET | /v1/clients | AI 授权列表 |
| POST | /v1/clients/{id}/revoke | 撤销本人授权，空 JSON 请求 |
| GET | /v1/export | 导出 lowkkey.showroom.v1 |

账户写操作检查 Origin；客户模式还要求 X-Lowkkey-Account，防止切换账户后的旧页面操作错误账户。原录入、事件流、导入、草稿、审批、提议、撤销记录 API 全部退役，返回 404。

## 源码与产物

唯一协议源为 packages/protocol/src。运行 ./scripts/run protocol:emit 生成 protocol/schema.json、openapi.json、mcp-tools.json。输出模式由运行 MCP 端到端测试与生成文件逐项比对。
# 公网内测补充

三个写工具保持输入参数不变，成功输出为 `{ result: 已保存的事实, view_url: 绝对地址 }`；JSON 文本与 `structuredContent` 内容一致。链接分别定位 `#Gallery?date=YYYY-MM-DD`、`#Weight?date=YYYY-MM-DD`、`#Plan?day=URL编码的训练日`。空计划可清空安排，链接仍进入计划页。

`get_brief` 仍为零参数，输出 `{ result: Brief }`。Brief 新增 `generated_at`（生成时刻，不是测量日期）、`coverage.training`（全历史最早/最晚日期、总训练日期数和本次返回数）、`coverage.weight`（测量日期范围和总数）。空范围的首尾日期为 null。

每项力量摘要新增 `recorded_sets` 和 `excluded_sets: [{reason,count}]`，统计全历史该动作，按每组一个原因计数：`warmup`、`reps_out_of_range`、`missing_bodyweight`、`non_positive_load`，优先级按此顺序。零记录与有记录但不能估算由此区分。次数 1–20、引体当天或此前体重、单只哑铃等原公式口径不变。

部署与真实客户端接入见 [公网内测说明](../showroom-beta.md)。
