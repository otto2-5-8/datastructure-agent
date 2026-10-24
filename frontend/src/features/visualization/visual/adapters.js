/**
 * adapters.js —— 把「某个算法的步骤」翻译成 array-renderer 认识的中性帧（03）
 *
 * 这一层是换算法的**唯一**成本：
 *   二分查找  → binarySearchFrame(step)   把 Step v1（区间 + L/R/M）映射成帧
 *   冒泡排序  → bubbleSortFrame(step)     双指针 j / j+1 + 已排序区
 *   线性查找  → linearSearchFrame(step)   单游标 cursor
 *
 * 适配器只做「读 step 里的字段 → 组装帧」，**不计算算法轨迹**：
 *   谁的步骤里写了什么，就画什么；没写的字段就当没有（不猜、不补）。
 *   所以冒泡的每一步必须由引擎（或静态 fixture）给出 array 快照 + pass/j + 是否交换。
 */

import { describeStep } from '../index.js';

const EVENT_TEXT = {
  init: '初始化',
  probe: '比较',
  'move-left': '更新左边界',
  'move-right': '更新右边界',
  found: '找到',
  'not-found': '未找到',
  compare: '比较相邻两个',
  swap: '交换',
  'pass-end': '本轮结束',
  done: '排序完成'
};

/* ---------------------------------------------------------------- 二分查找（Step v1） */
export function binarySearchFrame(step, { total = 0 } = {}) {
  if (!step) return null;
  const array = Array.isArray(step.array) ? step.array : [];
  const vars = step.variables || {};
  const { left, right, mid } = vars;
  const empty = array.length === 0;
  const rangeValid = !empty && left <= right;

  const cells = array.map((value, index) => {
    let state = 'idle';
    if (empty || index < left || index > right) state = 'excluded';
    if (step.event === 'found' && step.result === index) state = 'match';
    else if (mid !== null && mid !== undefined && index === mid) state = 'active';
    return { value, state };
  });

  const pointers = [];
  if (rangeValid) {
    pointers.push({ label: 'L', index: left, tone: 'l', title: `left=${left}` });
    pointers.push({ label: 'R', index: right, tone: 'r', title: `right=${right}` });
    if (mid !== null && mid !== undefined) pointers.push({ label: 'M', index: mid, tone: 'm', title: `mid=${mid}` });
  }

  return {
    cells,
    pointers,
    range: rangeValid ? [left, right] : null,
    caption: empty
      ? `空数组（left=${left}，right=${right}）：不访问任何元素`
      : `${EVENT_TEXT[step.event] ?? step.event} · ${describeStep(step)}`,
    meta: { algorithm: 'binary-search', stepIndex: step.stepIndex, event: step.event, done: step.done, total }
  };
}

/* ---------------------------------------------------------------- 冒泡排序 */
export function bubbleSortFrame(step, { total = 0 } = {}) {
  if (!step) return null;
  const array = Array.isArray(step.array) ? step.array : [];
  const sortedFrom = Number.isInteger(step.sortedFrom) ? step.sortedFrom : array.length;
  const comparing = Array.isArray(step.comparing) ? step.comparing : [];

  const cells = array.map((value, index) => {
    let state = 'idle';
    if (index >= sortedFrom) state = 'sorted';                                  // 已经排好的尾巴
    if (comparing.includes(index)) state = step.swapped ? 'swapped' : 'compare'; // 正在比/刚交换
    return { value, state };
  });

  const pointers = [];
  if (Number.isInteger(step.j)) {
    pointers.push({ label: 'j', index: step.j, tone: 'i', title: `第 ${step.pass} 轮比较位置 j=${step.j}` });
    if (step.j + 1 < array.length) pointers.push({ label: 'j+1', index: step.j + 1, tone: 'j', title: `j+1=${step.j + 1}` });
  }
  // 本轮结束时标记「刚归位」的那一格
  if (step.event === 'pass-end' && Number.isInteger(sortedFrom) && sortedFrom < array.length) {
    pointers.push({ label: '已归位', index: sortedFrom, tone: 'j', title: `A[${sortedFrom}] 本轮归位` });
  }

  const unsorted = sortedFrom > 0 ? [0, sortedFrom - 1] : null;
  // 比较的是**交换前**的两个值（fixture/引擎给了 step.values 就用它，否则退回当前快照）
  const compared = Array.isArray(step.values)
    ? step.values
    : comparing.map((index) => array[index]);
  const pair = comparing.length === 2
    ? `A[${comparing[0]}]=${compared[0]} 与 A[${comparing[1]}]=${compared[1]}`
    : '';
  const caption = step.event === 'done'
    ? `排序完成：${array.join(' ≤ ')}`
    : step.event === 'pass-end'
      ? `第 ${step.pass} 轮结束：最大的元素落到下标 ${sortedFrom}，后面 ${array.length - sortedFrom} 个已归位`
      : `第 ${step.pass} 轮 · 比较 ${pair}${step.swapped ? ' → 交换（大的往右冒）' : ' → 不交换'}`;

  return {
    cells,
    pointers,
    range: unsorted,
    caption,
    meta: { algorithm: 'bubble-sort', stepIndex: step.stepIndex, event: step.event, done: step.done, total }
  };
}

/* ---------------------------------------------------------------- 线性查找 */
export function linearSearchFrame(step, { total = 0 } = {}) {
  if (!step) return null;
  const array = Array.isArray(step.array) ? step.array : [];
  const cursor = Number.isInteger(step.cursor) ? step.cursor : -1;

  const cells = array.map((value, index) => {
    let state = 'idle';
    if (step.event === 'found' && step.result === index) state = 'match';
    else if (index === cursor) state = 'active';
    else if (cursor >= 0 && index < cursor) state = 'excluded';   // 看过且不相等
    return { value, state };
  });

  const pointers = cursor >= 0 ? [{ label: 'cursor', index: cursor, tone: 'm', title: `cursor=${cursor}` }] : [];
  const caption = step.event === 'init'
    ? `从头线性扫描：target=${step.target}，最多看 ${array.length} 个元素`
    : step.event === 'found'
      ? `A[${step.result}]=${array[step.result]} 等于 target=${step.target}：找到`
      : step.event === 'not-found'
        ? `走完全部 ${array.length} 个元素仍不等于 target=${step.target}：未找到`
        : `检查 A[${cursor}]=${array[cursor]} 是否等于 target=${step.target}`;

  return {
    cells,
    pointers,
    range: null,
    caption,
    meta: { algorithm: 'linear-search', stepIndex: step.stepIndex, event: step.event, done: step.done, total }
  };
}

export const FRAME_ADAPTERS = {
  'binary-search': binarySearchFrame,
  'bubble-sort': bubbleSortFrame,
  'linear-search': linearSearchFrame
};
