# 侧栏拖拽排序视觉验收

- source visual truth: `C:/Users/Snappni/Desktop/无标题.jpg`
- implementation screenshot: `C:/Users/Snappni/Desktop/Workspace/事件信号监控引擎/design-qa-sidebar-implementation.png`
- viewport: 1265 x 712 CSS px; implementation screenshot is a full viewport capture.
- source pixels: 211 x 403; source is a cropped sidebar reference. No density normalization was needed.
- state: local dashboard after moving “运行日志” above “信号复盘”; the changed order is intentional interaction state.

## Comparison evidence

- Full view: the implementation keeps the existing dark operations-desk layout, active navigation treatment, spacing rhythm, and footer placement. The source is a cropped sidebar, so the brand/header area is not directly comparable.
- Focused region: each navigation row now has a low-contrast three-line drag handle at the right edge, matching the reference affordance. The handle is a real Heroicons asset, not CSS-drawn bars.
- Interaction evidence: a real mouse drag moved `/logs.html` before `/signals.html`; a reload and navigation to `/summary.html` preserved the order, while the active page remained highlighted. ArrowUp also reorders the focused handle.

## Findings

- No actionable P0/P1/P2 differences in the requested control.
- P3: the supplied reference is a narrow crop without the current product brand block; the existing product header was preserved rather than redesigned.

## Implementation checklist

- [x] Mouse drag starts only from the right-side handle.
- [x] Order persists in browser local storage across pages and reloads.
- [x] Current-page active state and route URLs remain unchanged.
- [x] Keyboard ArrowUp/ArrowDown fallback is available on each handle.
- [x] Handle is hidden in the compact horizontal mobile navigation.
- [x] No browser console errors observed during verification.

final result: passed

