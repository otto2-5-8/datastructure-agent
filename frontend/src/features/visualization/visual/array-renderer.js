/**
 * array-renderer.js —— 通用「数组类算法」帧渲染器（03）
 *
 * 为什么要有这一层：
 *   二分查找的渲染器（本目录上一级 index.js）是给「候选区间 + L/R/M 三个固定指针」定做的，
 *   换个算法就不够用——冒泡要双指针 j / j+1 加「已排序区」，线性查找只要一个游标，
 *   堆排序要看树。与其给每个算法复制一份画格子的代码，不如把分工改一下：
 *
 *     ★ 适配器（或后端引擎）负责算出「这一帧长什么样」，渲染器只认一种中性的帧。
 *
 *   frame = {
 *     cells:    [{ value, state }],           // state: idle | excluded | compare | active | match | swapped | sorted
 *     pointers: [{ label, index, tone }],     // tone 只决定配色：l | r | m | i | j
 *     range:    [left, right] | null,         // 需要画「当前候选区」时才给
 *     caption:  '这一步发生了什么',            // 由适配器写，渲染器不猜
 *     meta:     { algorithm, stepIndex, event, done }
 *   }
 *
 * 换算法的成本 = 写一个 step → frame 的适配器（见 adapters.js），渲染器一行都不用改。
 * 指针数量、名字、含义全由算法自己定，渲染器不再假设「一定有 left/right/mid」。
 *
 * 纪律与二分查找渲染器一致：整帧重画，不缓存上一帧状态 —— 所以「上一步」是真恢复，
 * 不是回退动画；空数组不画任何格子；越界指针不画。
 */

const STATE_CLASS = {
  idle: '',
  excluded: 'is-excluded',
  compare: 'is-compare',
  active: 'is-active',
  match: 'is-match',
  swapped: 'is-swapped',
  sorted: 'is-sorted'
};

const POINTER_CLASS = {
  l: 'is-l',
  r: 'is-r',
  m: 'is-m',
  i: 'is-i',
  j: 'is-j'
};

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createArrayRenderer(container, { dots = true } = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('createArrayRenderer 需要一个容器元素（02 提供的挂载点）');
  }

  // 容器清空 + 一次性骨架：之后每帧只换里面的内容
  container.replaceChildren();
  container.dataset.renderer = 'array';
  const root = el('div', 'arender');
  const track = el('div', 'arender-track');
  const caption = el('p', 'arender-caption');
  root.append(track, caption);
  container.append(root);

  let frame = null;

  /** 把指针按「落在哪个下标」分组：同一格上的多个指针竖着叠，不互相盖住 */
  function groupPointers(pointers, cellCount) {
    const byIndex = new Map();
    (pointers || []).forEach((pointer) => {
      const index = pointer.index;
      // 越界指针（比如 right=-1 的空区间、排序里排完后的 j 越界）一律不画，免得指向空气
      if (!Number.isInteger(index) || index < 0 || index >= cellCount) return;
      if (!byIndex.has(index)) byIndex.set(index, []);
      byIndex.get(index).push(pointer);
    });
    return byIndex;
  }

  function renderCell(value, index, state, pointerList, rangeValid) {
    const cell = el('li', `arender-cell ${STATE_CLASS[state] ?? ''}`.trim());
    cell.dataset.index = String(index);
    cell.dataset.state = state || 'idle';
    if (rangeValid && index >= rangeValid[0] && index <= rangeValid[1]) cell.classList.add('is-in-range');

    const lane = el('span', 'arender-ptr-lane');
    pointerList.forEach((pointer) => {
      const badge = el('span', `arender-ptr ${POINTER_CLASS[pointer.tone] ?? 'is-i'}`, String(pointer.label));
      badge.dataset.ptr = pointer.label;
      if (pointer.title) badge.title = pointer.title;
      lane.append(badge);
    });

    cell.append(lane, el('span', 'arender-value', String(value)), el('span', 'arender-index', String(index)));
    return cell;
  }

  function render(nextFrame) {
    frame = nextFrame || null;

    if (!frame || !Array.isArray(frame.cells) || frame.cells.length === 0) {
      track.replaceChildren();
      track.dataset.empty = 'true';
      caption.textContent = frame && frame.caption ? frame.caption : '没有可画的数据（空数组不画假格子）';
      root.dataset.empty = 'true';
      return;
    }

    const range = Array.isArray(frame.range) && frame.range.length === 2 ? frame.range : null;
    const rangeValid = range && range[0] <= range[1] ? range : null;
    const pointers = groupPointers(frame.pointers, frame.cells.length);

    const list = el('ol', 'arender-cells');
    frame.cells.forEach((cell, index) => {
      list.append(renderCell(cell.value, index, cell.state || 'idle', pointers.get(index) || [], rangeValid));
    });

    track.replaceChildren(list);
    delete track.dataset.empty;
    delete root.dataset.empty;
    caption.textContent = frame.caption || '';

    if (dots) {
      // 进度点：帧里带 total 就画，没有就不画（渲染器不假设算法结构）
      const total = frame.meta && Number.isInteger(frame.meta.total) ? frame.meta.total : 0;
      if (total > 1) {
        const rail = el('ol', 'arender-dots');
        for (let i = 0; i < total; i += 1) {
          const dot = el('li', 'arender-dot');
          if (i === frame.meta.stepIndex) dot.classList.add('is-current');
          else if (i < frame.meta.stepIndex) dot.classList.add('is-past');
          rail.append(dot);
        }
        track.append(rail);
      }
    }
  }

  function destroy() {
    container.replaceChildren();
    delete container.dataset.renderer;
    frame = null;
  }

  return { render, destroy, getFrame: () => frame };
}
