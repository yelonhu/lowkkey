# lowkkey · 交接包

AI 原生的训练状态舱。本包把**前端定稿**和**对外暴露的接口**说清楚，后端与 MCP 由 coding agent 按此开发。
包内不含任何真实个人数据；前端里的数字均为示例。

| 路径 | 内容 | 先读顺序 |
|---|---|---|
| `INTERFACE.md` | 三方权限、前端每屏读什么调什么、REST / SSE / MCP 暴露、实体、派生值键名、闸门、不变量、开发顺序 | 1 |
| `frontend/lowkkey-frontend.html` | 前端基准：8 个产品屏幕 + 进入训练过渡 + 图标，共 10 个画板；浏览器直接打开，顶部切屏，屏内链接可点，「总览」看全部 | 2 |
| `DESIGN.md` | 产品原则、屏幕规格、视觉系统（色板、字体、文案、杠铃图、动效与触感） | 3 |
| `protocol/openapi.json` | REST v1，OpenAPI 3.1 | 按需 |
| `protocol/mcp-tools.json` | MCP `tools/list` 返回体 | 按需 |
| `protocol/schema.json` | 全部实体的 JSON Schema | 按需 |
| `reference/`（可选） | 上述协议的 zod 源码 + 规则引擎参考实现（解析器、闸门、验证器、派生值），`npm i && npm test` 可跑 | 按需 |

一句话：**模型负责理解，规则负责计算和把关，数据只属于用户。**
