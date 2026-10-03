# lowkkey 接口说明 v1.0

> 前端画板见 `frontend/lowkkey-frontend.html`（示例数据，非真实记录）；本文件规定**谁能做什么、前端要什么、后端和 MCP 暴露什么**。视觉与交互细节见 `DESIGN.md`，当前实现见仓库根目录的 `src/` 与 `packages/`。

---

## 0. 一句话

**模型负责理解，规则负责计算和把关，数据只属于用户。**

- 模型（Claude / GPT / 任意）把自然语言、截图翻译成结构化条目，并在规则覆盖不到的地方提建议。
- 规则（确定性代码）算出所有数字（趋势、e1RM、下一组重量、周组数、触发器），并决定一条输入能否直接记录。
- 用户是唯一能撤销、改计划、做决定的一方。

---

## 1. 三方与权限

| 能力 | 用户（网页 / App） | 模型（MCP） | 规则（服务端） |
|---|---|---|---|
| 读取状态与派生值 | ✓ | ✓ `read` | — |
| 写入新条目（必须过闸） | ✓ | ✗；模型仅以 `submit` 提交待审批次 | ✓（仅触发器执行） |
| 提出计划修改（进收件箱） | ✓ | ✓ `propose` | ✓（如里程碑建议） |
| 回答「需要确认」 | ✓ | ✗ | ✗ |
| 撤销任何一条 | ✓ | ✗ | ✗ |
| 修改训练计划 | ✓ | ✗（只能提议） | ✗ |
| 采用 / 拒绝提议与建议 | ✓ | ✗ | ✗ |

Token 按 scope 发放：`user`（仅用户会话）、`read`、`submit`、`propose`。**以服务端判定为准，客户端声称的能力不作数。**

---

## 2. 前端需要什么

前端只做展示与交互，**不计算任何结论性数字**：所有数字从 `derived` 读取（带公式，用于 ƒ 抽屉）。前端可以做纯展示层换算：单位 kg/lb、取整、杠片拆分。

| 屏幕 | 读取 | 调用 |
|---|---|---|
| 01 今日 | `program.days`（今天对应的训练日）、`derived.rx.*`、最近一条体重、`derived.bw.slope7d`、`derived.cycle.week`、待决 `triggers`、`held` 数量 | `POST /v1/capture`（捕获栏）；`POST /v1/triggers/{id}/decision`（采用 / 以后）；`POST /v1/entries/{id}/revert`（撤销条）；开始训练 = `POST /v1/entries` 写一条 `session:start` |
| 02 需要确认 | `held[]` 与 `submissions[]`（模型批次、问题、原话与草稿） | `POST /v1/held/{id}/resolve`；`POST /v1/submissions/{id}/review`；`POST /v1/submissions/{id}/decision` |
| 03 训练中 | 当前动作的 `derived.rx.*`、`derived.next.<exerciseId>`（下一组建议）、本场已完成的组 | `POST /v1/entries`（`kind:set`，`inSession:true`）；结束 = 写 `session:end` |
| 04 体征 | 每日体重、`derived.bw.*`、`program.targets`、当前触发器、腰围 | `POST /v1/triggers/{id}/decision`；`POST /v1/capture`（录入腰围） |
| 05 进步 | `derived.rel.*`、`derived.e1rm.*`、`derived.volume.*`、规则提议 | `POST /v1/proposals/{id}/decision`（「加入计划」） |
| 06 日志 | `entries[]`（含 `source`、撤销关系） | `POST /v1/entries/{id}/revert` |
| 07 接入 | 实际 OAuth 客户端、scope 与撤销状态 | `GET /v1/clients`、`POST /v1/clients/{id}/revoke`；OAuth `/authorize` |
| 09 训练完成 | 本场组、相关 `derived.e1rm.*`、`deferUntilSessionEnd` 的 `held` | `POST /v1/held/{id}/resolve` |

实时更新：订阅 `GET /v1/events`（SSE），收到事件后局部刷新或重新拉取 `/v1/state`。

---

## 3. 后端暴露：REST v1

JSON，客户网页通过应用会话认证（Access 模式仅用于管理与兼容环境），路径前缀 `/v1`。Remote MCP 的 OAuth Bearer 令牌只用于 `/mcp`。完整结构见 `protocol/openapi.json`。

| 方法 | 路径 | scope | 作用 |
|---|---|---|---|
| GET | `/state?from&to` | user, read | 快照：entries、held、proposals、triggers、program、exercises、**derived** |
| POST | `/capture` | user | 标准文字由确定性解析器处理；请求固定 `capturedAt`、`capturedLocalDate`、`timeZone`，离线重试沿用原值 |
| POST | `/entries` | user | 用户写入草稿（过闸），返回 `{committed, held, unparsed}` |
| POST | `/submissions/{id}/decision` | user | `{decision:accept|skip,answers,expectedRevision}`；接受时重跑闸门并原子写入全部草稿，版本冲突返回 409 |
| POST | `/submissions/{id}/review` | user | `{answers}`；按当前状态预览下一层闸门问题，完全不入账；返回 `{questions,ready,revision}` |
| POST | `/entries/{id}/revert` | user | 撤销：追加一条 `revert`，不删除原记录 |
| POST | `/held/{id}/resolve` | user | `{optionId}` 或 `{skip:true}` |
| POST | `/proposals` | user, propose | 提出计划修改（JSON Merge Patch） |
| POST | `/proposals/{id}/decision` | user | `accept` / `reject` |
| POST | `/triggers/{id}/decision` | user | `accept`（立即生效）/ `later`（本期作废，可附原因） |
| GET / PUT | `/program` | 读：user, read；写：user | 训练计划 |
| GET | `/export` · POST `/import` | user | 带账户 ID 的全量备份；仅允许本人且为已有账本的超集，导入只追加 |
| GET / PUT | `/preferences/timezone` | user | 读取 / 设置本人 IANA 时区，供 MCP 日期解释使用 |
| GET | `/events` | user, read | SSE 事件流 |
| GET / POST | `/clients` · `/clients/{id}/revoke` | user | GET 查看 OAuth 授权，POST 撤销指定客户端；新连接经 OAuth 授权 |

错误统一为 `{ error: { code, message, details? } }`，code ∈ `bad_request / unauthorized / forbidden / not_found / conflict / invalid_state / internal`。

SSE 事件：`entry.committed`、`entry.reverted`、`held.created`、`held.resolved`、`submission.created`、`submission.decided`、`proposal.created`、`proposal.decided`、`trigger.updated`、`program.updated`、`client.revoked`、`backup.imported`。

---

## 4. MCP 暴露

远程 MCP（Streamable HTTP）。每个工具就是对上面服务层的一次调用，外加 scope 校验。输入 JSON Schema 见 `protocol/mcp-tools.json`。

| 工具 | scope | 作用 |
|---|---|---|
| `get_state` | read | 读取状态与全部派生值。**引用任何数字前必须先读这里，不得自行计算** |
| `get_history` | read | 某个动作最近 n 次训练的组 |
| `run_verifiers` | read | 按需运行 V1–V10，回答「为什么是这个数」 |
| `propose_entries` | submit | 提交带固定捕获时钟与幂等键的草稿批次；所有条目在用户一次确认前均不入账 |
| `propose_change` | propose | 提出计划修改；规则已能算出的处方不要提议 |
| `list_inbox` | read | 待用户处理的事项 |

**刻意不存在的工具**：revert、update、delete、decide、put_program、log_entries。模型永远只能提交待审批次和计划提议。

授权的实际 scope 由用户在 OAuth 同意页选择：`read`、`submit`、`propose`。

---

## 5. 数据实体（摘要）

完整定义见 `protocol/schema.json`；其 Zod 源码位于仓库根目录的 `packages/protocol/src/`。

- **Entry（只追加的事件日志）** 公共字段：`id, kind, date(用户本地日期), dateOrigin(explicit|device|inferred), createdAt, source{actor, channel, client, rawText}`
  - `weight`：`kg, raw{value,unit}, condition(fasted|post_bm|unspecified)`
  - `set`：`sessionId, exerciseId, setIndex, load, unit, loadKind(external|assist|bodyweight), reps, rir|null`
  - `session`：`sessionId, event(start|end), dayId`
  - `waist`：`cm` · `note`：`text` · `directive`：`calorie_delta, kcal, effectiveFrom, triggerId`
  - `revert`：`targetId, reason`（仅用户）
- **Held（需要确认）**：`gate, drafts[], question, context, highlight, options[{id,label,hint,suggested,action,reverts,patches}], skip, deferUntilSessionEnd`
- **Proposal**：`author, kind, title, rationale, ruleRefs, patch, status`
- **Trigger**：`rule, dueDate, threshold, current, action{calorie_delta,kcal}, status(pending|will_fire|fired|accepted_early|vetoed|not_met)`
- **Program**：`cycleStart, ramp[], days[{id,name,weekday,items[{exerciseId,sets,repMin,repMax,startLoad}]}], constraints[], targets{bodyweightKg, rateKgPerWeek, weeklySets, calorieTrigger}`
- **Exercise**：`id, name, aliases, type(barbell|dumbbell|machine|cable|assisted|bodyweight), unit, barLoad, perHand, muscles{肌群: 权重}`
- **Derived**：`key, label, value, unit, rule, ruleVersion, inputs[], asOf, formula`

规范：日期一律用用户本地日期 `YYYY-MM-DD`；时间戳只用于排序审计。原始值与原始单位永远保存，kg 为计算单位。

---

## 6. 派生值键名（前端按键读取）

| 键 | 含义 | 验证器 |
|---|---|---|
| `bw.slope7d` / `bw.slopeAll` | 近 7 天 / 全程增重速度 kg/周 | V1 |
| `bw.projection` / `bw.projectionTarget` | 按当前趋势 / 目标速度到达目标体重还需几天 | V1 |
| `cycle.week` | 周期第几周 | V6 |
| `e1rm.best.<ex>` / `e1rm.first.<ex>` / `e1rm.latest.<ex>` | 最佳 / 首次 / 最近 e1RM | V2, V3 |
| `rel.<ex>` | 最近 e1RM ÷ 最近体重 | V2 |
| `rx.<dayId>.<ex>` | 下次处方重量（formula 含组数、次数区间、目标 RIR） | V6 |
| `next.<ex>` | 训练中：下一组建议重量 | V5 |
| `volume.<muscle>` | 本周有效组 | V7 |

---

## 7. 写入流程与闸门

`说一句 → 解析 → 过闸 → 通过则直接记录（给撤销条）/ 不通过则进入「需要确认」`

| 闸 | 拦截条件 | 问什么 |
|---|---|---|
| G1 歧义 | 一句话有多个可行解（如「125那组rir0」对得上两组） | 「是哪一组？」 |
| G2 日期 | 日期是推断的（非用户写明、非设备今天） | 「记到哪一天？」 |
| G3 覆盖 | 同日同类已有记录 | 「替换，还是两条都保留？」 |
| G4 离群 | 体重日变化 > 1.5 kg；e1RM 较最佳 > +15%；单位可疑 | 「确认是 X 吗？」 |
| G5 低置信 | 模型解析 confidence < 0.85 | 显示模型的理解，让用户确认 |

同一句话里无歧义的部分照常记录，只拦有问题的那一项。训练中产生的拦截不弹窗，延后到训练完成页。
同一草稿连续触发多个闸门时逐级回答；替换撤销及新记录在最后一道闸门通过后才一起追加。模型批次在所有问题回答后仍须用户按底部「写入 N 条」，任何预览都不入账。

---

## 8. 不变量（验收红线）

1. 模型只能追加（且过闸），不能修改、撤销、删除。
2. 日期不由模型推断后直接入账。
3. 只追加：撤销 = 新增一条 `revert`。
4. 每个派生值都能追溯到公式与输入条目。
5. 原始值与原始单位永远保存。
6. 用户约束优先于通用区间（如「腿每周一次」不告警）。
7. 有歧义就问，只问那一处。
8. 「今日」最多一个待你决定的事项。
9. 界面分三层：一句结论 → 图 → 公式（ƒ 抽屉）。
10. 训练中不打断。

---

## 9. 验证器（公式）

| id | 规则 |
|---|---|
| V1 | 体重对日期做最小二乘，斜率 × 7 = kg/周；7 日窗口与全程；少于 3 点不算 |
| V2 | 1 次为实际举起重量；其余 e1RM = 有效负荷 × (1 + 次数/30)，仅为估算；> 12 次标记偏差大，> 20 次不算 |
| V3 | 辅助动作有效负荷 = 当日体重 − 辅助（kg） |
| V4 | 仅明确标记为热身的组排除；未分类单列，降重不自动等于热身 |
| V5 | 次数 ≥ 上限且 RIR ≥ 2 → 最多 +1 档；次数 < 下限 → 最多 −1 档；其他保持。变化不得超过有效负荷 10%，器械档位不满足或辅助负荷未知则保持 |
| V6 | 最近完成场次有完整处方，全部正式组达到上限且 RIR ≥ 1 才考虑 +1 档；缺数据沿用。周期仅用户启用，结束后恢复基础计划，不重复末周 |
| V7 | 每肌群分别显示正式、未分类及基础计划的折算组数；不设置统一合格线 |
| V8 | 用户确认目标速度、观察期与调整配置后，至少 7 个日读数、跨度至少 13 天才评估；仅生成建议。到期不执行，“采用”才追加指令 |
| V9 | 描述 Δ腰围 / Δ体重，不判合格 |
| V10 | 称重条件为背景信息；排便后不自动判为异常 |

档位：杠铃上肢 +5 lb、下肢 +10 lb；哑铃 +5 lb；器械 +1 片；辅助 −1 档。杠片：lb `[45,35,25,10,5,2.5]`，kg `[25,20,15,10,5,2.5,1.25]`。

---

## 10. 机器可读文件

| 文件 | 用途 |
|---|---|
| `protocol/openapi.json` | REST v1（OpenAPI 3.1），可直接生成服务端桩与客户端 |
| `protocol/mcp-tools.json` | MCP `tools/list` 返回体 |
| `protocol/schema.json` | 全部实体的 JSON Schema（2020-12），其他语言可据此生成类型 |
| `../../packages/protocol/src/` | 协议的 Zod 源码；`npm run protocol:emit` 更新本目录的机器可读文件 |

规则实现与测试位于仓库根目录的 `packages/core/`。`next.<ex>` 已由当前派生值实现提供，OAuth 客户端接口已写入 `openapi.json`。

---

## 11. 当前实现位置

1. **规则与派生值**：`packages/core/src/`；协议与工具契约：`packages/protocol/src/`。
2. **存储**：Cloudflare D1，迁移位于 `db/migrations/`；新版条目只追加，旧账本通过读取适配保留。
3. **REST、SSE 与 MCP**：`src/server/`，入口为 `src/server/worker.ts`。
4. **前端**：`src/app/` 直接读取本目录的画板 HTML，并绑定 `/v1/state` 与写入接口。
5. **验证**：`packages/core/test/`、`tests/`；本地检查命令见仓库根目录 `README.md`。


## 12. 2026-09-30 自然训练体验契约

- `targets.goal`：`gain / lose / maintain / record`；用户保存后服务端写入 `confirmedAt`。速度、目标体重、维持范围均可不设置。新模板不附带个人增重、每周组数目标或热量调整。
- `setRole`：`work / warmup / unknown`；缺失为未知。更正追加 `set_annotation {targetId,setRole}`，撤销标注即恢复此前分类，原组 ID 与内容不变。
- 训练开始保存服务端计算的 `prescription`；推荐记录可带 `recommendation {load,unit,ruleVersion,inputs}`。这表示提交时显示的建议，实际负荷始终以条目的 `load/unit` 为准。
- `POST /v1/decisions/today`：仅网页用户调用，按账户当地日期原子占用一个主动建议位。读取 MCP 状态不会占位。关闭或处理后不补发第二项；其他项目留在日志。
- 提议与触发器决定请求均要求 `expectedRevision`；过期返回 409 并重新审阅。`later` 保持未决并写入 `snoozedUntil`，最早次日重新评估；不等同拒绝。
- 计划 patch 只允许 Program 字段，合并后验证；不允许原型字段、未知字段或客户端伪造确认时间。
- 规则版本提升为 1.1.0。原始账本保留；规则结果按新版本重新派生。程序源协议支持读取既有快照，目标空值与决策版本要求需客户端按本节更新。
- 所有模型记录仍先进入待审批次；MCP 不提供 HTML/DOM 编辑、确认、撤销或直接改计划工具。

数值依据：
- [ACSM 2026：训练目标与个体化](https://acsm.org/resistance-training-guidelines-update-2026/)
- [渐进负荷指导](https://pubmed.ncbi.nlm.nih.gov/19204579/)
- [增重研究及适用限制](https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/)
- [减重速度研究及适用人群](https://pubmed.ncbi.nlm.nih.gov/21558571/)

一个器械档位、10% 上限、14 天及最少读数是本产品的保守执行策略，不是针对所有人的生理定律；用户可直接覆盖本组建议。

### 协议 2.0.0 变更记录

REST 继续使用 `/v1` 路径；快照与生成契约的协议版本升为 2.0.0，包版本不变。目标速度和周组数可以为空，宏观决策必须携带 `expectedRevision`，因此这是契约主版本更新。持久化旧记录读取时不改 ID、原始单位或事实；对外快照标注当前协议版本。客户端须使用本次生成的 Schema，处理空目标及 `set_annotation`。模型仍只读状态和提交提案。

## 客户账户与 AI 提案契约（协议 3.0.0）

客户模式采用应用会话；Access 保留为管理、隔离环境及显式旧账户迁移。完整配置、路由和验收边界见 `../account-ai-rollout.md`。客户写操作必须携带当前 `X-Lowkkey-Account`，防止离线队列在换号后错误发送。

工具源码与运行时注册统一使用协议包。新增 `list_exercises`、`get_review`、精确审阅链接和 MCP Apps 只读卡片。`get_state` 的条目与 `get_history` 的场次分页；后者返回 `{items,nextCursor}`，因此提升主版本。模型草稿必须提供置信度。`propose_change` 使用明确的 ProgramPatch，支持与计划同时待审的自定义动作，记录 baseProgram 与提交时 revision。已有动作负荷语义不能覆盖。

`propose_entries` 的 `corrects` 指向本人已有同类记录，用户确认时追加 revert 和替代记录，未确认不影响事实。`set_annotation` 可提议组别纠正。模型仍没有决定、撤销、直接改计划或直接入账权限。`GET /v1/reviews/{kind}/{id}` 返回当前处理结果，用户审阅链接带事项 ID；不会默认打开别的待审事项。
