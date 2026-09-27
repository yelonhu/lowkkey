# lowkkey · 交接包

AI 原生的训练状态舱。本目录是前端画板、产品原则与对外接口的规格；当前实现位于仓库根目录的 `src/` 与 `packages/`。
包内不含任何真实个人数据；前端里的数字均为示例。

| 路径 | 内容 | 先读顺序 |
|---|---|---|
| `INTERFACE.md` | 三方权限、前端每屏读什么调什么、REST / SSE / MCP 暴露、实体、派生值键名、闸门、不变量、开发顺序 | 1 |
| `frontend/lowkkey-frontend.html` | 前端基准：8 个产品屏幕 + 进入训练过渡 + 图标，共 10 个画板；浏览器直接打开，顶部切屏，屏内链接可点，「总览」看全部 | 2 |
| `DESIGN.md` | 产品原则、屏幕规格、视觉系统（色板、字体、文案、杠铃图、动效与触感） | 3 |
| `protocol/openapi.json` | REST v1，OpenAPI 3.1 | 按需 |
| `protocol/mcp-tools.json` | MCP `tools/list` 返回体 | 按需 |
| `protocol/schema.json` | 全部实体的 JSON Schema | 按需 |

协议与规则源码分别位于仓库根目录的 `packages/protocol` 和 `packages/core`。运行 `npm run protocol:emit` 可从协议源码更新 `protocol/` 下的机器可读文件。

一句话：**模型负责理解，规则负责计算和把关，数据只属于用户。**
