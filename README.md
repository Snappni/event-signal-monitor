# 事件信号监控引擎

本项目是一个本地运行的加密市场事件与量化信号监控系统。系统持续采集市场数据和消息数据，生成纸面告警候选，并通过模拟账户记录持仓、成本、收益和风险指标。

## 主要功能

- 高频层每 1 分钟处理行情、资金费率、OI、Polymarket、交易所公告和 Whale Alert。
- 低频层每 5 分钟处理国际新闻、事件复核、模型校准和交易复盘。
- 消息面缺失时继续使用数学模型分析，不中断候选生成。
- 支持保守型和激进型模拟策略风格。
- 模拟合约与现货账户，计入手续费、滑点和资金费率。
- 展示净值、回撤、滚动夏普、逐笔盈亏和成本侵蚀。
- Whale Alert API Key 可在本地页面验证和保存，明文不会返回前端。

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

`.env` 中的 Whale Alert 密钥可以留空，启动页面后在“消息面”区域输入并验证。

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

运行报告、账户状态、日志和本地凭据均写入：

```text
.runtime/event-signal-monitor/
```

该目录不应提交到 Git。
