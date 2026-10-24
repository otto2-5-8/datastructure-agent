/**
 * dev-algos.js —— 「换算法」演示页逻辑（03）
 *
 * 三件事，没有第四件：
 *   1. 取三条轨迹：二分查找（后端真实引擎，失败退回 fixtures）、冒泡排序与线性查找（fixtures 静态数据）
 *   2. 每条轨迹配一个「step → 帧」的适配器（visual/adapters.js）
 *   3. 同一套 createPlayback + 同一个 createArrayRenderer 驱动它们
 *
 * 本页**不计算任何算法轨迹**：冒泡的每一步 array 快照、j、是否交换都写在 fixtures 里，
 * 线性查找的 cursor 也是；页面只负责把步骤翻译成帧再画出来。
 */

import { createPlayback } from '../playback/index.js';
import { createArrayRenderer } from './visual/array-renderer.js';
import { FRAME_ADAPTERS, binarySearchFrame } from './visual/adapters.js';

const $ = (selector) => document.querySelector(selector);

const state = {
  entries: [],        // [{ key, label, adapter, steps, fromApi, sourceVersion }]
  current: null,
  playback: null,
  renderer: null,
  stepIndex: 0
};

/* ------------------------------------------------------------------ 数据来源 */

/** 二分查找：先要真实引擎的 run，拿不到再退回 fixtures/mock-runs.json（并明确标注） */
async function loadBinarySearch() {
  try {
    const response = await fetch('/api/algorithms/binary-search/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ array: [1, 3, 5, 7, 9], target: 7 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const run = await response.json();
    if (!Array.isArray(run.steps) || run.steps.length === 0) throw new Error('引擎返回的 steps 为空');
    return {
      key: 'binary-search:api',
      label: `二分查找 [1, 3, 5, 7, 9] 找 7（真实引擎 ${run.sourceVersion || ''}）`.replace(/\s+/g, ' '),
      adapter: binarySearchFrame,
      steps: run.steps,
      fromApi: true,
      sourceVersion: run.sourceVersion || ''
    };
  } catch (error) {
    const mock = await fetch('./fixtures/mock-runs.json').then((r) => r.json());
    const run = (mock.runs || mock)[0];
    return {
      key: 'binary-search:mock',
      label: `二分查找 [1, 3, 5, 7, 9] 找 7（fixtures 兜底：引擎不可用 ${String(error.message || error)}）`,
      adapter: binarySearchFrame,
      steps: run.steps,
      fromApi: false,
      sourceVersion: run.sourceVersion || 'mock'
    };
  }
}

async function loadFixtureAlgorithms() {
  const response = await fetch('./fixtures/mock-sort-runs.json');
  if (!response.ok) throw new Error(`读取 fixtures/mock-sort-runs.json 失败：HTTP ${response.status}`);
  const fixture = await response.json();
  return (fixture.algorithms || []).map((item, index) => ({
    key: `${item.algorithm}:${index}`,
    label: item.label,
    adapter: FRAME_ADAPTERS[item.algorithm] || null,
    steps: item.steps,
    fromApi: false,
    sourceVersion: item.sourceVersion || 'mock'
  })).filter((item) => item.adapter && Array.isArray(item.steps) && item.steps.length);
}

/* ------------------------------------------------------------------ 渲染 */

function frameFor(entry, step) {
  return entry.adapter(step, { total: entry.steps.length });
}

function renderStep(step, info = {}) {
  const entry = state.current;
  if (!entry) return;
  state.stepIndex = info.stepIndex ?? state.stepIndex;
  state.renderer.render(frameFor(entry, step || entry.steps[0]));

  const total = info.total ?? entry.steps.length;
  $('#counter').textContent = `第 ${state.stepIndex + 1} 步 / 共 ${total} 步`;
  $('#btn-prev').disabled = !(info.canPrev ?? state.stepIndex > 0);
  $('#btn-next').disabled = !(info.canNext ?? state.stepIndex < total - 1);
  $('#btn-play').textContent = info.playing ? '⏸ 暂停' : '▶ 播放';
  $('#btn-play').disabled = total <= 1;
}

function bindEntry(entry) {
  state.playback?.destroy();
  state.current = entry;
  state.stepIndex = 0;

  const badge = $('#source-badge');
  badge.textContent = entry.fromApi ? `数据来源：后端真实引擎 ${entry.sourceVersion}`.trim() : '数据来源：fixtures 静态数据（非引擎）';
  badge.dataset.source = entry.fromApi ? 'api' : 'mock';

  // 换算法只是换 steps 数组 + 适配器；播放控制与渲染器都是同一个实例
  state.playback = createPlayback({
    runId: entry.key,
    steps: entry.steps,
    intervalMs: Number($('#speed-select').value),
    onStepChange: (info) => renderStep(info.step, info)
  });

  renderStep(entry.steps[0], {
    stepIndex: 0,
    total: entry.steps.length,
    canPrev: false,
    canNext: entry.steps.length > 1,
    playing: false
  });
}

/* ------------------------------------------------------------------ 启动 */

async function boot() {
  const select = $('#algo-select');
  const stage = $('#stage');
  state.renderer = createArrayRenderer(stage, { dots: true });

  try {
    const [binary, fixtures] = await Promise.all([loadBinarySearch(), loadFixtureAlgorithms()]);
    state.entries = [binary, ...fixtures];
  } catch (error) {
    stage.dataset.empty = 'true';
    stage.textContent = `加载失败：${String(error.message || error)}。请通过 npm start 打开本页（file:// 会被 CORS 拦掉）。`;
    return;
  }

  select.replaceChildren(...state.entries.map((entry) => {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = entry.label;
    return option;
  }));

  select.addEventListener('change', () => {
    const next = state.entries.find((entry) => entry.key === select.value);
    if (next) bindEntry(next);
  });

  $('#btn-prev').addEventListener('click', () => state.playback?.prev());
  $('#btn-next').addEventListener('click', () => state.playback?.next());
  $('#btn-play').addEventListener('click', () => {
    if (!state.playback) return;
    if (state.playback.getState().playing) state.playback.pause();
    else state.playback.play();
  });
  $('#btn-reset').addEventListener('click', () => state.playback?.reset());
  $('#speed-select').addEventListener('change', () => state.playback?.setSpeed(Number($('#speed-select').value)));

  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); state.playback?.next(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); state.playback?.prev(); }
    else if (event.key === ' ') {
      event.preventDefault();
      if (!state.playback) return;
      if (state.playback.getState().playing) state.playback.pause();
      else state.playback.play();
    }
  });

  bindEntry(state.entries[0]);
}

boot();

/* 供自检脚本读取：证明「同一个渲染器 / 同一套播放控制，换算法只换适配器」 */
window.__devAlgos = {
  entries: () => state.entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    fromApi: entry.fromApi,
    steps: entry.steps.length,
    adapter: entry.adapter === binarySearchFrame ? 'binarySearchFrame' : (entry.adapter?.name || '?')
  })),
  select: (key) => {
    const entry = state.entries.find((item) => item.key === key);
    if (!entry) return false;
    const select = $('#algo-select');
    if (select) select.value = entry.key;
    bindEntry(entry);
    return true;
  },
  seek: (index) => {
    if (!state.playback) return null;
    while (state.playback.getState().stepIndex < index) state.playback.next();
    while (state.playback.getState().stepIndex > index) state.playback.prev();
    return state.playback.getState();
  },
  probe: () => {
    const cells = [...document.querySelectorAll('#stage .arender-cell')];
    return {
      rendererNodes: document.querySelectorAll('#stage .arender').length,
      cells: cells.length,
      pointers: [...document.querySelectorAll('#stage .arender-ptr')].map((node) => node.textContent),
      states: cells.map((cell) => cell.dataset.state),
      caption: document.querySelector('#stage .arender-caption')?.textContent ?? null,
      counter: $('#counter')?.textContent ?? null,
      source: $('#source-badge')?.textContent ?? null,
      stepIndex: state.playback ? state.playback.getState().stepIndex : null
    };
  }
};
