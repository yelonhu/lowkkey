# lowkkey protocol v5

唯一机器契约在 `packages/protocol`。运行 `./scripts/run protocol:emit` 生成本目录 `protocol/{schema,openapi,mcp-tools}.json`；CI 检查生成结果一致。旧 V1–V10、提议、审批、事件流均为历史。

## 权限与工具

网页使用受邀账户会话。MCP 使用 OAuth `read/write`，账户来自令牌，不接受调用方指定 owner。全权限七项：`get_brief`、`log_session`、`log_weight`、`set_plan`、`set_profile`、`curate`、`delete`。没有业务审批；客户端自己的确认独立存在。

每个写工具返回 `{result: 保存后的对象, view_url}`。删除返回被删对象；不存在报错。校验失败不提交任何字段。训练和体重按日期覆盖；计划按 title 更新，weekday 0 为周日、同星期唯一，空 items 删除。

训练格式为 `{date,title,sets,note?}`；拒绝 raw_text。每组使用 `ex/load/unit/kind/reps/rir/role`，可加 `cheat/partial/per`；`per:side` 为单边未知总重。`custom` 必须给 name，以名称归并。kind 为 external、assist、bodyweight；引体/双杠的 bodyweight load 是额外负重，0 即徒手。热身、递减、不完整组不参与 e1RM，降重组参与。单位可为 lb/kg；哑铃按单只。

计划 items 使用 `ex/load/unit/loadKind/sets/min/max`，支持 `name/per/optional/note/restSec/targetRir/nextLoad/progressRule`；coach 省略保留、null 清空。profile 独立保存 `gain_target:{start,startLb,min,max}` 与 body_notes，省略保留、null 清空，原始目标精度不改。

## 策展

`curate({week,theme?,next?,recap?,body?,log?})` 中 week 必须周一。递归合并 recap，省略保留、null 清空；log 按训练日期合并，null 删除批注。每次成功写入保存完整版本。文本以纯文本显示，不执行 HTML。

- theme 为 gold/pearl，why 必填、不超过 40 字。
- next 必须今天或未来有计划的日期，text 不超过 120 字。
- recap.title 12 字；letter 1–5 段、每段 240 字；sign 为 `claude · MM.DD`，省略时服务端生成。
- picks 1–2 件，日期在指定周内且有记录；器械 picks 的动作必须当天出现。title 24 字、note 80 字。五种类型：barbell/dumbbell/assist/weight/rhythm。
- focus 仅四个主项；body.text 160 字；log 每条 100 字且对应已有训练。
- 策展文字拒绝 emoji、感叹号，字数按 Unicode 码点计算。

MCP instructions 原样采用确认的 v5 文档，不含模型手算。`get_brief({sessions?:0..30})` 默认 6，完整数据优先，不静默截断。返回生成时间、Chicago 今天、下一安排、全部计划/profile、当前主题与本周手动选择、体重均线截止日期/样本数、四项力量、各动作最近两次紧凑记录、训练摘要、week_facts、当前策展及最近四周标题/主题。

## 领域计算

`packages/core` 为网页与 MCP 共用的唯一计算入口。严格次数 = 总次数 − 借力次数。Epley：1 次取净负荷，2–20 次乘 `1+次数/30`；热身、递减、不完整、单边未知总重不计算。引体与双杠只用当天或此前体重，加额外负重或减辅助；无体重不计算。

七日均值取 D−6..D 实际称重，至少 4 次；14 日速度对实际日期最小二乘回归乘 7，至少 8 次。今天及周界统一 America/Chicago。目标状态比较未舍入速度；派生数值通常一位，rate14 两位。未来四周带从有效当前均值出发，历史线从目标起点出发。

主项 PR、杠铃一片/两片、超过体重、停滞至少三次及突破由有效事实生成。辅助最少纪录要求至少八次严格完成，同辅助选最近日期。计划历史按实际生效日保存；无历史依据不推断 missed/streak/首次完整达标。

## REST 与持久化

`GET /v1/state` 返回账户事实、profile、策展/批注、主题与计划历史；`POST /v1/preferences/theme` 仅供已登录网页，检查 Origin 和账户；导出、客户端授权撤销等账户接口保留。

v5 使用 showroom_sessions/showroom_weights/showroom_plans、profiles、preferences、curations、curation_versions、annotations、plan_history。所有表按 owner 隔离。用户修正或删除事实后派生值立即重算；失效 picks 在网页跳过。迁移及备份见 `../showroom-beta.md`。
