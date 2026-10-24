# 动画（成员03）

**已实现**：按共享 Step 快照绘制数组格子、下标、`L / R / M` 指针、当前搜索区间、被排除格子变淡、
命中/未找到结果，以及空数组、单元素、`mid=null`、空区间这些边界。整帧重渲染，所以回看是真恢复。

- 入口：`createVisualization(container, { run, legend, dots, explainContainer })`
  → `{ showStep, getStep, playEnterAnimation, destroy }`（`showStep(null)` 是明确的空态，不抛错）
- 样式：同目录 `visualization.css`（浅色默认 token `--viz-*`，宿主必须引）
- 正式入口：`npm start` 后访问工作台 `/`（02 的页面壳内嵌本模块，03 只占 `#visualization-panel`）；
  03 自己的五区 UI 在 `/src/features/visualization/dev-morph.html`，工作台顶栏有入口链接。
- 接入 02 的说明：`C02-INTEGRATION.md`

## 03 的 UI 页面（保留，不作为生产入口）

| 文件 | 作用 |
| --- | --- |
| `dev-morph.html/.css/.js` | 五区工作台：代码显示 / 算法可视化窗口 / 步骤辅导 / 过程练习 / 本机记录，单区切换 + 三栏同屏 |
| `dev-viz-window.js/.css` | 可移动、可缩放、可全屏的可视化窗口：视口平移缩放、两层网格、时间轴刻度与播放头、本步解释浮层 |
| `dev.html` + `dev-theme.css` | 上一版深色自测页（并列保留，用于视觉对照） |
| `dev-code-panel.js` / `dev-input-panel.js` / `dev-agent-panel.js` / `dev-outliner.js` / `dev-grid.js` | 02 / 05 / 07 区域的**自测替身**，只为让 03 的窗口和联动有真实数据可用 |
| `fixtures/mock-runs.json` / `fixtures/mock-source-lines.json` | 离线兜底数据，只在拿不到真实 run 时使用 |

这些页面消费同一份 `run.steps`，不计算轨迹；`dev-morph.html` 的步骤辅导直接调
`POST /api/agent/explain`（成功显示模型回答 + 步骤引用 + 知识卡出处，失败原样显示后端错误码，
不伪造回答）。生产渲染器本身不依赖 `fixtures/` 或这些页面。

## 换算法：帧渲染层（`visual/`）

`index.js` 的渲染器是给二分查找定做的（候选区间 + L/R/M 三个固定指针）。要让动画按**别的算法
自己的逻辑**显示，不再复制一份画格子的代码，而是把分工拆成四层：

```
step（引擎输出） → adapter（算法专属：读 step 组装帧） → frame（中性帧） → renderer（通用）
```

- `visual/array-renderer.js` + `.css`：通用数组帧渲染器。只认
  `{ cells: [{value, state}], pointers: [{label, index, tone}], range, caption }`，
  不认 `left / right / mid`；指针有几个、叫什么、什么颜色都由算法自己定
  （二分 `L/R/M`、冒泡 `j / j+1`、线性 `cursor`）。
- `visual/adapters.js`：`binarySearchFrame` / `bubbleSortFrame` / `linearSearchFrame`，
  把各自步骤翻成帧。只读字段、不计算轨迹；字段没给就当没有，不猜不补。
- `dev-algos.html`：同一套 `createPlayback` + **同一个渲染器实例**，切换二分查找 / 冒泡排序 /
  线性查找。二分查找取后端真实引擎的 run；冒泡与线性查找用 `fixtures/mock-sort-runs.json` 的
  **静态**轨迹（**不是引擎输出**，只用来证明渲染层与播放层跟算法无关）。

真正接一个新算法要动三处：**04** 按步骤契约产出轨迹；**03** 加一个 `xxxFrame(step)` 适配器
（必要时加一种 `kind`：数组 / 树 / 图 / 链表）；**02** 把新 run 接到同一套播放控制与步骤分发上。
注意当前 `shared/schemas/step.schema.json` 仍把 `algorithm` 写死为 `binary-search`、
`variables` 必含 `left/right/mid` —— 接第二个引擎之前要先把契约泛化。

正式工作台已接入04真实run、02代码变量、05辅导和07练习记录。回归使用tests/workbench.browser.mjs。08独立验收仍待完成。

约束：只消费 `steps`，不计算另一套算法；`mid=null` 不展示为 0；空数组不画假节点；回看恢复历史快照。
