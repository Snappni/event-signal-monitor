# 动态持仓卡片 Design QA

- final result: passed
- 验证日期：2026-07-19
- 源参考：
  - `C:\Users\Snappni\AppData\Local\Temp\codex-clipboard-c3af8e81-674a-43bf-84c9-488c72086adc.png`
  - `C:\Users\Snappni\AppData\Local\Temp\codex-clipboard-0c6c4d54-a6b6-432b-8a70-d1a7d58dfb10.png`
- 最终对比图：`C:\Users\Snappni\.codex\visualizations\2026\07\19\019f79d9-9b76-7792-af7a-1965642d844f\design-qa-comparison-final.png`
- 手机端聚焦图：`C:\Users\Snappni\.codex\visualizations\2026\07\19\019f79d9-9b76-7792-af7a-1965642d844f\dynamic-position-card-mobile-stable.png`

## 对比结论

- 布局：保留原卡片的标的、方向、杠杆、盈亏和六格关键数据层级；在中间加入完整宽度的价格结构图。风险风格徽标已按需求替换为预测胜率和计划盈亏比。
- 图表：真实价格只有一条连续轨迹；动态止盈和动态止损使用阶梯线；开仓、原始止盈、原始止损使用虚线；收益区和初始风险区使用低对比度背景区分。没有用静态图片或 CSS 图形替代数据图表。
- 字体与颜色：沿用项目已有字体、暗色表面、边框、圆角和状态色；盈利、亏损、止盈、止损的语义颜色保持一致，文字与背景对比可读。
- 响应式：在 1280×720、900×800 和 390×844 三种视口验证。桌面和平板无页面横向溢出；手机端修复了徽标导致的持仓列表横向滚动，最终 `body/list/card` 的 `scrollWidth` 均等于各自可用宽度。
- 交互：持仓详情使用原生 `details/summary`，已实际点击验证展开；动态参数、盈利保护因子、原始线和一次部分止盈状态均可见。图表 Canvas 成功初始化，窗口变化会重新计算尺寸。
- 可访问性：图表容器有中文 `aria-label`，ECharts ARIA 已启用；详情控件可键盘访问；保留项目现有焦点、禁用和选中状态；小屏文字允许换行。
- 内容：监控状态不再固定显示“高频监控中”，而是根据事件驱动服务与行情流连接状态显示运行、连接或停止。

未发现阻断交付的视觉、响应式、交互或可访问性问题。
