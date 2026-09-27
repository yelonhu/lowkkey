# iPhone 交互打磨与验收

本轮从 `1764ec2` 开始，保持包版本 0.6.0。可见结构继续直接读取 `lowkkey-handoff/frontend/lowkkey-frontend.html`；该文件、REST/MCP 契约和规则引擎未修改。本文记录实现与验收，不替代交接规格。

## 已实现

- 绑定在脱离文档的副本中计算，随后按原始节点标识、记录 ID 局部更新真实节点。缓存页面与滚动位置，保留输入焦点、光标、中文组合输入及未发送草稿。
- 控件按下缩到 0.97；写入期间立即禁用重复操作。成功反馈等待服务端确认；网络失败或响应丢失时保留请求内容、捕获时钟及幂等键。重试旧记录不会覆盖后来输入的新草稿。
- 今日进入训练为 620 ms 墨滴扩散；结束训练停留在完成页，返回今日时为 480 ms 收回。普通页面淡入 160 ms，sheet 升降 320 ms。后续触碰可以中断动效，清除旧遮罩；减弱动态效果时训练为 200 ms 交叉淡入，取消其余缩放与位移。
- Sheet 保留真实背景页面与滚动位置；支持顶部拖动、Escape、浏览器返回、焦点约束和关闭后恢复焦点。关闭不产生接受或跳过决策。过期审阅刷新后由用户重新确认。
- 使用 visualViewport、动态页面高度、安全区域和紧凑视口滚动处理键盘、工具栏及可用空间变化；页面恢复可见后重新获取状态并恢复 SSE。

## 自动化与视觉对比

2026-09-27 本地结果：TypeScript、全仓 ESLint、生产构建通过；33 个规则/API 测试、48 个 Chromium/WebKit 浏览器测试通过；独立 OAuth/MCP 端到端回归通过。此结果不包含下方的真机与公网验收。

Playwright 同时运行 Chromium 和移动 WebKit，每个引擎使用独立的临时 D1。OAuth 浏览器测试使用本地 HTTPS，以便 WebKit 按实际规则处理 Secure cookie。测试证书由本机 OpenSSL 临时生成，随该次测试数据库一起删除；不会修改系统证书信任或本地用户 D1。

覆盖：首用、记录与撤销、离线重试、批次原子确认及过期冲突、客户端撤销、训练流程、连续点按、中文组合输入、输入期间 SSE、稳定列表节点与滚动、sheet 手势与返回、失败保留输入、已提交但响应丢失、减少动态效果、紧凑视口及复制反馈。

视觉比较使用同一份隔离 D1 空账户状态、相同视口和字体加载条件，对比 `1764ec2` 与本轮实现：

| 画板 | 比较结果 |
| --- | --- |
| Main、Session、Body、Progress、Ledger、Transition、Debrief、Icon | 像素一致 |
| Connect | 排除两个本地端口造成的连接地址文本差异后，像素一致 |
| Capture | 背景按本轮要求替换为真实当前页面，因此整屏不同；sheet 尺寸一致，24 个像素存在最大 1/255 的颜色通道差异，位于手柄与文字的抗锯齿边缘 |

本地证据：`.artifacts/interaction-before/`、`.artifacts/interaction-after/`、`.artifacts/interaction-visual-report.json`。每轮完整浏览器测试另输出 `.artifacts/playwright/chromium/v1-*.png` 和 `.artifacts/playwright/webkit/v1-*.png`。这些运行产物不纳入 Git。

运行：

```sh
./scripts/run check
./scripts/run test
./scripts/run build
./scripts/run test:e2e
```

本地 OAuth/MCP 独立回归：先运行 `node scripts/serve.mjs --e2e`，再运行 `node tests/oauth-mcp.e2e.mjs`。

## 尚需人工验收

自动化中的移动 WebKit 不等于真实 iPhone Safari。本轮未完成下列真机验收，不能据此标记产品 v1 可交付：

- [ ] 记录 iPhone 型号、iOS 版本；Safari 与添加到主屏幕后分别走完「记录 → 查看刷新 → 训练 → 审阅 → 撤销」。
- [ ] 中文系统键盘、光标选择、输入自动缩放、键盘收起后布局、底部安全区域、工具栏展开与收起。
- [ ] 前后台切换、系统返回手势、连续触碰中断动画、开启「减弱动态效果」后的实际观感。
- [ ] 独立测试域名、D1、KV、Access 就绪后，用官方 Claude 客户端完成授权、读取、提案、网页审阅、入账、撤销和撤销客户端授权；随后验证账户支持的 ChatGPT 接入。
- [ ] 日常使用验证后，再决定标记可交付 v1。

浏览器视觉与操作反馈已经接入；不承诺 iPhone 浏览器提供原生触觉反馈。本轮没有增加休息计时。
