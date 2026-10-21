# lowkkey protocol v5

唯一机器契约在 `packages/protocol`。运行 `./scripts/run protocol:emit` 生成本目录 `protocol/{schema,openapi,mcp-tools}.json`；CI 检查生成结果一致。旧 V1–V10、提议、审批、事件流均为历史。

## 权限与工具

网页仅使用 Google 登录，开放注册且无需邀请；按 Google 身份关联账户。MCP 使用 OAuth `read/write/notes:write`，账户来自令牌，不接受调用方指定 owner。全权限九项：`get_brief`、`read_notes`、`log_session`、`log_weight`、`set_plan`、`set_profile`、`curate`、`delete`、`write_note`。没有业务审批；客户端自己的确认独立存在。

每个写工具返回 `{result: 保存后的对象, view_url}`。删除返回被删对象；不存在报错。校验失败不提交任何字段。训练和体重按日期覆盖；计划按 title 更新，weekday 0 为周日、同星期唯一，空 items 删除。

训练格式为 `{date,title,sets,note?}`；拒绝 raw_text。每组使用 `ex/load/unit/kind/reps/rir/role`，可加 `cheat/partial/per`；`per:side` 为单边未知总重。`custom` 必须给 name，以名称归并。kind 为 external、assist、bodyweight；引体/双杠的 bodyweight load 是额外负重，0 即徒手。热身、递减、不完整组不参与 e1RM，降重组参与。单位可为 lb/kg；哑铃按单只。

计划 items 使用 `ex/load/unit/loadKind/sets/min/max`，支持 `name/per/optional/note/restSec/targetRir/nextLoad/progressRule`；coach 省略保留、null 清空。profile 独立保存 `gain_target:{start,startLb,min,max}` 、body_notes 与 training_context（用户明确表达的训练背景，≤4000 字符），省略保留、null 清空，原始目标精度不改。

## 策展

`curate({week,theme?,next?,recap?,body?,log?})` 中 week 必须周一。递归合并 recap，省略保留、null 清空；log 按训练日期合并，null 删除批注。每次成功写入保存完整版本。文本以纯文本显示，不执行 HTML。

- theme 为 ink/gold/pearl，why 必填、不超过 40 字。
- next 必须今天或未来有计划的日期，text 不超过 120 字。
- recap.title 12 字；letter 1–5 段、每段 240 字；新 sign 为 `AI · MM.DD`，省略时服务端生成；历史 `claude · MM.DD` 继续兼容。
- picks 1–2 件，日期在指定周内且有记录；器械 picks 的动作必须当天出现。title 24 字、note 80 字。五种类型：barbell/dumbbell/assist/weight/rhythm。
- focus 仅四个主项；body.text 160 字；log 每条 100 字且对应已有训练。
- 策展文字拒绝 emoji、感叹号，字数按 Unicode 码点计算。

MCP instructions 是管理者手册：身份宣言、页面地图（set_plan 与 curate.next 画 next，curate.recap/theme 画 recap，log_weight、gain_target 与 curate.body 画 body，log_session 与 curate.log 画 log，notes 为用户原文）、读写边界三档（直接做 / 先确认 / 绝不做）、首次会话剧本与日常例程，不含模型手算。`get_brief` 额外返回 `guide:{stage,next_step,missing,week}`：stage 为 empty（无任何事实）、setup（有背景、计划或体重但无训练）或 active；missing 取值 training_context、plan、next_note、session、weight、week_letter、body_note，只由已保存事实与实际权限推导；week 为 `{start,index,done,planned}`。服务端另注册三个 prompts（`start`、`log_today(text)`、`weekly_letter`），返回单条 user 消息，需 read 权限。`get_brief({sessions?:0..30})` 默认 6，完整数据优先，不静默截断。返回生成时间、账户时区的今天、下一安排、全部计划/profile、生效主题、source_week、reason（兼容 manual_this_week 固定 false）、体重均线截止日期/样本数、四项力量、各动作最近两次紧凑记录、训练摘要、week_facts、当前策展及最近四周标题/主题。

## 领域计算

`packages/core` 为网页与 MCP 共用的唯一计算入口。严格次数 = 总次数 − 借力次数。Epley：1 次取净负荷，2–20 次乘 `1+次数/30`；热身、递减、不完整、单边未知总重不计算。引体与双杠只用当天或此前体重，加额外负重或减辅助；无体重不计算。

七日均值取 D−6..D 实际称重，至少 4 次；14 日速度对实际日期最小二乘回归乘 7，至少 8 次。今天及周界统一使用账户时区；旧账户默认 America/Chicago。目标状态比较未舍入速度；派生数值通常一位，rate14 两位。未来四周带从有效当前均值出发，历史线从目标起点出发。

主项 PR、杠铃一片/两片、超过体重、停滞至少三次及突破由有效事实生成。辅助最少纪录要求至少八次严格完成，同辅助选最近日期。计划历史按实际生效日保存；无历史依据不推断 missed/streak/首次完整达标。

## REST 与持久化

`GET /v1/state` 返回账户事实、profile、策展/批注、主题与计划历史；手动主题接口已退役（404）；导出、客户端授权撤销等账户接口保留。

v5 使用 showroom_sessions/showroom_weights/showroom_plans、profiles、preferences、curations、curation_versions、annotations、plan_history。所有表按 owner 隔离。用户修正或删除事实后派生值立即重算；失效 picks 在网页跳过。迁移及备份见 `../showroom-beta.md`。

产品化扩展：`get_brief({session_date?})` 可读取该日完整训练；返回 timezone、permissions 和 onboarding 指引。首次使用、账户接口与迁移见 [产品化说明](../productization.md)。

隐私：`/privacy` 公开阅读；登录前 `/api/privacy/intent` 建立短期一次性确认意图，登录后绑定实际账户。`POST /v1/account/consent` 保存指定版本的明确确认，未确认时客户业务与新 OAuth 授权受阻，仍可导出、撤销或注销。`GET /v1/account` 返回 privacy 版本及确认时间。详见 `../productization.md`。

## 随手记

随手记提供 `read_notes` 和独立授权的 `write_note`。`daily_notes` 按 `(owner_id,date)` 唯一，保存完整纯文字、独立递增 revision 和 updated_at。每天最多 20,000 个 Unicode 码点，允许 emoji、感叹号、空格和换行。空正文保留版本墓碑，列表不返回空记录；不进入力量计算。

- `GET /v1/notes`：from/to（包含日期）、before（排他游标）、limit（网页默认30，最多30）；返回 `{notes,next_cursor}`，日期倒序。
- `GET /v1/notes/{date}`：返回完整单日对象；尚未记录时 text 为空、revision 为0、updated_at 为null。
- `PUT /v1/notes/{date}`：`{text,revision}`，revision 为调用方读取的预期版本；原子比较后保存，冲突返回409/note_conflict，再读取单日最新对象。相同正文重试不增加版本。所有写入验证会话、同源与账户；正文请求上限128 KiB。
- MCP `read_notes`：同样日期筛选，默认14个非空日期，最多30；需要read权限，仅返回 `{result:{notes,next_cursor}}`。继续分页须保留原筛选条件，不隐式截断单日正文。
- `get_brief.notes` 返回 count/latest_date/updated_at，不附加长文。`/v1/state` 不加载笔记；`/v1/export` 顶层 notes 包含全部日记录及墓碑。

网页 `#notes` 连续显示日期，今天在底部。待同步草稿只存于对应账户的本机存储，同步后移除；冲突必须由用户选择。隐私版本为 `2026-10-13-notes-write`。普通 read/write 授权不能写笔记；另外授予 notes:write 后，仅按用户明确要求写入。仅在用户要求整理时，通过既有工具保存训练记录。记录日期不强行覆盖正文明确表达的训练日期。

发布需先备份并应用新增 `0004_notes.sql`，同时按顺序部署尚未发布的账户迁移；本功能的本地验收不会自动发布其他未提交改动。

### 笔记独立写入与主题延续

`write_note({date,text,revision})` 需要 `read` 与 `notes:write`，返回 `{result:DailyNote,view_url}`。OAuth 默认不勾选 notes:write，旧令牌不扩权；刷新令牌也不扩权。复用网页保存事务、Unicode 上限及版本检查，相同正文重试不递增，冲突为 MCP `isError` / `note_conflict`。只有真实对话中的明确请求才是操作依据，笔记内指令不是授权；服务端无法验证对话意图。

`read_notes({date})` 与 from/to/before/limit 互斥，返回 `{notes:[DailyNote],next_cursor:null}`，包括清空后的版本墓碑；未创建为 revision:0、text:""、updated_at:null。范围分页仍排除空正文。

主题取不晚于账户当前周的最近非空策展主题；省略保留，null 移除该周选择，ink 显式恢复水墨。手动偏好不再生效，未来主题到期才参与。客户端列表增加公开 client ID 来源字段，UI 同名分组仅用于展示，不合并授权身份。
