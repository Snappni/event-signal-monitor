# 事件信号监控引擎

本项目是一个本地运行的加密市场事件与量化信号监控系统。系统持续采集市场数据和消息数据，生成纸面告警候选，并通过模拟账户记录持仓、成本、收益和风险指标。

## 主要功能

- 高频层每 1 分钟处理行情、资金费率、OI、Polymarket、交易所公告和可选 Whale Alert。
- 低频层每 5 分钟处理内置固定 RSS、NewsNow 国内外热榜、GDELT 国际新闻、事件复核、模型校准和交易复盘。
- 使用统一事件结构接收新闻、热榜、公告、预测市场和链上事件，并进行关键词过滤、热榜排名跟踪、来源分级、近似故事聚类与跨源佐证。
- 在交易所公告入口过滤例行上币、新现货交易对和新永续合约通知；下架、暂停、风险与安全公告仍保留。
- 对 Polymarket 的加密资产价格阈值市场跟踪多方/空方隐含概率、多空比和相较上轮变化，并纳入事件方向与影响评分。
- 消息面缺失时继续使用数学模型分析，不中断候选生成。
- 支持保守型和激进型模拟策略风格。
- 模拟合约与现货账户，计入手续费、滑点和资金费率。
- 展示净值、回撤、滚动夏普、逐笔盈亏和成本侵蚀。
- 数学层包含 GBM、GARCH、HMM、泊松事件到达、贝叶斯后验校准和 Markowitz 配置。
- 12 个 RSS 与 7 个 NewsNow 热榜来源直接内置；不依赖 RSSHub、DailyHotApi、TrendRadar 进程或 Docker，页面仅允许调整保留关键词。
- Whale Alert 已降为可选兼容源，未配置 API Key 不再产生系统告警。

## 安全边界

本项目默认仅执行 `paper-alert-only` 模拟告警，不包含实盘下单逻辑。任何真实交易接入都必须独立实现权限隔离、签名、限额、审计和人工授权。

API Key 保存在本地 `.runtime/` 或 `.env` 中。这两个路径均被 Git 忽略。不要把真实密钥写入源码、README、Issue 或提交记录。

无证据表明新闻聚合、大模型推理、Polymarket 赔率或当前数学模型能够稳定盈利。历史模拟结果不能证明未来收益。

## 环境要求

- Windows 10/11
- Node.js 20 或更高版本
- PowerShell 5.1 或更高版本

## 安装

```powershell
npm ci
Copy-Item .env.example .env
```

`.env` 中的 Whale Alert 密钥可以留空。消息来源清单固定在源码中，运行时配置不能覆盖来源；仪表盘“消息面”区域只保存启用状态和保留关键词。内置 RSS 由项目直接请求和解析，热榜直接调用 NewsNow 缓存接口，不需要额外启动 Docker、RSSHub、DailyHotApi、TrendRadar 或 NewsNow 服务。

消息进入评分前会按标题相似度合并为故事簇。重复报道只保留来源等级更高的代表项；等级相同时优先保留本轮响应更快的来源。其余来源只作为交叉佐证，不会重复放大事件分数。热榜来源保存首次出现时间、当前/上一轮排名、最佳排名、出现次数和排名动量。

## 启动

启动高频循环：

```powershell
npm run signal:fast:loop
```

启动低频循环：

```powershell
npm run signal:slow:loop
```

启动本地仪表盘：

```powershell
npm run dashboard
```

浏览器访问：`http://127.0.0.1:8788/`

停止监控循环：

```powershell
npm run signal:fast:stop
npm run signal:slow:stop
```

## 验证

```powershell
npm run check
npm audit
```

## 数据与状态

运行报告、账户状态、聚合器配置、连接状态、日志和本地凭据均写入：

```text
.runtime/event-signal-monitor/
```

该目录不应提交到 Git。
