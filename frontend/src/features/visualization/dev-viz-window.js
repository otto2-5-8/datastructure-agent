/**
 * dev-viz-window.js — 从旧 dev.html 抽出来的【可视化窗口】，可复用、可移动
 *
 * 复用的部分（与旧 dev.html 完全同构，只把 id 换成 data-* 以便多实例）：
 *   · 视口：拖拽平移 + 滚轮以光标为锚点缩放 + Home 复位 + 自适应取景（fitView）
 *   · 两层屏幕网格（细 16px / 粗 80px），透明度随缩放交叉变化 —— 复用 dev-grid.js
 *   · 视口抬头：数组视图 / 复位视图 / 重播入场动效
 *   · 右上角「本步解释」浮层（在变换图层外面，所以不跟平移缩放）
 *   · 时间轴：用例下拉、速度下拉、⏮ ◀ ▶ ⏸ ▶ ⏭ 传送键、起始/当前/结束、可点击的步进刻度 + 播放头
 *   · 左下角提示：拖拽平移 · 滚轮缩放 · Home 复位
 *
 * 与页面的接口：不自己造步骤，全部由调用方通过 setStep(state) 灌进来；
 * 传送键/刻度点击通过回调交给宿主的 playback（本模块不持有计时器）。
 *
 * ================= [02 unsupports] 这里留给 02 的接缝 =================
 * [02 unsupports] 「用例」下拉：正式页面里可选案例是 02 调创建运行接口后得到的 run（或历史 run 列表），
 *   本模块只负责把传进来的 runs 渲染成下拉、把选择回传给 onSelectRun；它不自己造 run、不调接口。
 * [02 unsupports] 步骤广播：本模块只通过 onSeek / onTransport 回调把"用户想跳/想播"告诉宿主，
 *   再由 02 的装配层决定是否转发给 05/07（C06 未定，故此模块不发全局事件）。
 * [02 unsupports] 挂载与销毁：窗口挂在 02 给的容器里；换 run 时由 02 调 destroy() 或由 03 的
 *   dev 页重建实例，本模块不监听 runId 变化。
 * =====================================================================
 */

import { createVisualization } from './index.js';
import { applyGridOpacity } from './dev-grid.js';

const SPEEDS = [
  [2000, '2 秒/步'],
  [1000, '1 秒/步'],
  [500, '0.5 秒/步'],
  [250, '0.25 秒/步']
];

const TEMPLATE = `
<div class="win-bar">
  <span class="win-dot" aria-hidden="true"></span>
  <span class="win-title">可视化</span>
  <span class="win-sub">二分查找 · 闭区间 · 数组视图</span>
  <span class="win-actions">
    <button class="win-action" type="button" data-viz-full title="铺满整个屏幕（Esc 退出）">全屏</button>
    <button class="win-action" type="button" data-viz-fit title="铺满工作区">最大化</button>
    <button class="win-action" type="button" data-viz-reset title="回到默认大小">复位窗口</button>
  </span>
</div>
<div class="win-body-viz">
  <section class="viewport" aria-label="可视化演示">
    <div class="viewport-head">
      <span class="vh-title">数组视图</span>
      <span class="vh-sub">二分查找 · 闭区间</span>
      <span class="vh-actions">
        <button class="bl-btn" type="button" data-viz-view-reset title="复位视图（Home）">复位视图</button>
        <button class="bl-btn" type="button" data-viz-replay>重播入场动效</button>
      </span>
    </div>
    <div class="viewport-body" data-viz-body>
      <div class="viewport-grid" data-grid="fine" aria-hidden="true"></div>
      <div class="viewport-grid" data-grid="coarse" aria-hidden="true"></div>
      <div class="viewport-scene" data-viz-scene></div>
    </div>
    <div data-explain-host aria-label="本步解释"></div>
    <div class="viewport-warn" data-viz-warn hidden></div>
    <div class="viewport-hint">拖拽平移 · 滚轮缩放 · Home 复位</div>
  </section>

  <section class="timeline" aria-label="播放控制">
    <div class="tl-head">
      <div class="tl-left">
        <label class="bl-field">用例
          <select data-tl-run aria-label="用例"></select>
        </label>
        <label class="bl-field">速度
          <select data-tl-speed aria-label="播放速度"></select>
        </label>
      </div>
      <div class="tl-transport" data-tl-transport>
        <button class="tl-btn" type="button" data-t="reset" title="跳到开始并停止（重置）" aria-label="重置">
          <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2.5" width="1.6" height="9"/><path d="M11 2.5 5.2 7 11 11.5z"/></svg>
        </button>
        <button class="tl-btn" type="button" data-t="prev" title="上一步（恢复上一个快照）" aria-label="上一步">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 2.5 4 7l5.5 4.5z"/></svg>
        </button>
        <button class="tl-btn btn-play" type="button" data-t="play" title="播放" aria-label="播放">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.5 10.5 7 3.5 11.5z"/></svg>
        </button>
        <button class="tl-btn btn-pause" type="button" data-t="pause" title="暂停（停在当前步，可提问）" aria-label="暂停">
          <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3.4" y="2.5" width="2" height="9"/><rect x="6.6" y="2.5" width="2" height="9"/></svg>
        </button>
        <button class="tl-btn" type="button" data-t="next" title="下一步" aria-label="下一步">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5 8.4 7 2.5 11.5z"/></svg>
        </button>
        <button class="tl-btn" type="button" data-t="last" title="跳到结束" aria-label="跳到结束">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2.5 6.8 7 1 11.5z"/><rect x="8.4" y="2.5" width="1.6" height="9"/></svg>
        </button>
      </div>
      <div class="tl-right">
        <span class="bl-num">起始 <b data-tl-start>1</b></span>
        <span class="bl-num">当前 <b data-tl-current>1</b></span>
        <span class="bl-num">结束 <b data-tl-end>1</b></span>
      </div>
    </div>
    <div class="tl-ruler" data-tl-ruler tabindex="0" role="slider"
         aria-label="步骤时间轴：点击或按左右方向键跳到某一步"
         aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
      <div class="tl-ticks" data-tl-ticks></div>
      <div class="tl-playhead" data-tl-playhead><span class="tl-playhead-label" data-tl-playhead-label>1</span></div>
    </div>
  </section>
</div>
`;

export function createVizWindow(host, {
  runs = [],
  run = null,
  speedMs = 1000,
  onSelectRun = null,
  onSpeedChange = null,
  onSeek = null,
  onTransport = null
} = {}) {
  if (!host) throw new Error('createVizWindow 需要一个容器');

  const root = document.createElement('section');
  root.className = 'win vizwin';
  root.dataset.win = 'viz';
  root.innerHTML = TEMPLATE;
  host.append(root);

  // 防御：若上一个窗口异常销毁、body 上残留了全屏类，这里兜一次，保证"新窗口不是全屏"
  if (!document.querySelector('.vizwin[data-full="true"]')) {
    document.body.classList.remove('is-viz-full');
  }

  const $ = (selector) => root.querySelector(selector);
  const vizHost = $('[data-viz-scene]');
  const explainHost = $('[data-explain-host]');
  const body = $('[data-viz-body]');
  const scene = $('[data-viz-scene]');
  const warn = $('[data-viz-warn]');
  const grids = { fine: $('[data-grid="fine"]'), coarse: $('[data-grid="coarse"]') };
  const tickHost = $('[data-tl-ticks]');
  const playhead = $('[data-tl-playhead]');
  const playheadLabel = $('[data-tl-playhead-label]');
  const ruler = $('[data-tl-ruler]');
  const transport = $('[data-tl-transport]');
  const runSelect = $('[data-tl-run]');
  const speedSelect = $('[data-tl-speed]');

  const view = { x: 0, y: 0, scale: 1, min: 0.25, maxFit: 3, max: 6 };
  let viz = null;
  let currentRun = run;
  let state = { stepIndex: 0, total: 0, playing: false, canPrev: false, canNext: false };

  /* ---------------- 用例 / 速度下拉 ---------------- */
  runSelect.replaceChildren(...runs.map((item) => {
    const option = document.createElement('option');
    option.value = item.runId;
    option.textContent = item.label || item.runId;
    return option;
  }));
  speedSelect.replaceChildren(...SPEEDS.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    if (value === speedMs) option.selected = true;
    return option;
  }));
  if (currentRun) runSelect.value = currentRun.runId;
  runSelect.addEventListener('change', () => onSelectRun?.(runSelect.value));
  speedSelect.addEventListener('change', () => onSpeedChange?.(Number(speedSelect.value)));

  /* ---------------- 视口：平移 / 缩放 / 取景 ---------------- */
  function applyView() {
    scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    applyGridOpacity(grids, view.scale);
  }

  function warnIfCanvasTiny() {
    const w = Math.round(body.clientWidth);
    const h = Math.round(body.clientHeight);
    const tiny = w < 240 || h < 170;
    warn.hidden = !tiny;
    if (tiny) warn.textContent = `可视区只有 ${w}×${h}px，数组会被压得很小：可以把窗口拖大或点「最大化」。`;
  }

  function fitView() {
    const cw = body.clientWidth || 1;
    const ch = body.clientHeight || 1;
    const sw = scene.offsetWidth || 1;
    const sh = scene.offsetHeight || 1;
    const fit = Math.min(cw / sw, ch / sh) * 0.92;
    view.scale = Math.min(view.maxFit, Math.max(view.min, fit));
    view.x = 0;
    view.y = 0;
    applyView();
    warnIfCanvasTiny();
  }

  let panning = false;
  let panStart = { x: 0, y: 0 };
  body.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('button, select, input, .bsviz-explain')) return;
    panning = true;
    panStart = { x: event.clientX - view.x, y: event.clientY - view.y };
    body.classList.add('is-panning');
    body.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  body.addEventListener('pointermove', (event) => {
    if (!panning) return;
    view.x = event.clientX - panStart.x;
    view.y = event.clientY - panStart.y;
    applyView();
  });
  const stopPan = () => { panning = false; body.classList.remove('is-panning'); };
  body.addEventListener('pointerup', stopPan);
  body.addEventListener('pointercancel', stopPan);
  body.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = body.getBoundingClientRect();
    const cx = event.clientX - rect.left - rect.width / 2;
    const cy = event.clientY - rect.top - rect.height / 2;
    const next = Math.min(view.max, Math.max(view.min, view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const k = next / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = next;
    applyView();
  }, { passive: false });

  const onHomeKey = (event) => {
    if (event.key !== 'Home') return;
    if (root.closest('.panel')?.classList.contains('is-active') === false) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
    event.preventDefault();
    fitView();
  };
  window.addEventListener('keydown', onHomeKey);

  $('[data-viz-view-reset]').addEventListener('click', fitView);
  $('[data-viz-replay]').addEventListener('click', () => viz?.playEnterAnimation());

  $('[data-viz-fit]').addEventListener('click', () => {
    setFull(false);
    root.style.left = '0px';
    root.style.top = '0px';
    root.style.width = '100%';
    root.style.height = '100%';
    root.dataset.fitted = 'true';
    requestAnimationFrame(fitView);
  });
  $('[data-viz-reset]').addEventListener('click', () => {
    setFull(false);
    root.style.left = '';
    root.style.top = '';
    root.style.width = '';
    root.style.height = '';
    root.dataset.fitted = 'false';
    requestAnimationFrame(fitView);
  });

  /* 全屏：整个窗口铺满屏幕；外壳（标题栏/时间轴）改用页面同色的半透明，画布仍保持深色。
     全屏会盖住顶栏与分区胶囊，所以标题栏留「退出全屏」，并且 Esc 也能退。 */
  const fullBtn = $('[data-viz-full]');
  let fitTimer = null;

  function setFull(on) {
    root.dataset.full = on ? 'true' : 'false';
    // 全屏时页面里那层带 transform 的容器必须摘掉：祖先有 transform 时 position:fixed 会退化成相对定位
    document.body.classList.toggle('is-viz-full', on);
    if (on) {
      root.style.left = '';
      root.style.top = '';
      root.style.width = '';
      root.style.height = '';
      root.dataset.fitted = 'false';
    }
    if (fullBtn) fullBtn.textContent = on ? '退出全屏' : '全屏';
    requestAnimationFrame(fitView);
    // 延迟取景必须自己管住：窗口被销毁后这个回调还会跑，所以存住句柄、destroy 时清掉
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { fitTimer = null; fitView(); }, 260);
  }
  fullBtn.addEventListener('click', () => setFull(root.dataset.full !== 'true'));
  const onEsc = (event) => {
    if (event.key === 'Escape' && root.dataset.full === 'true') {
      event.preventDefault();
      setFull(false);
    }
  };
  window.addEventListener('keydown', onEsc);

  /* ---------------- 时间轴 ---------------- */
  function renderRuler(total) {
    const count = Math.max(1, total);
    tickHost.replaceChildren(...Array.from({ length: count }, (_, index) => {
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.dataset.index = String(index);
      const dot = document.createElement('span');
      dot.className = 'tl-dot';
      tick.append(dot, document.createTextNode(String(index + 1)));
      return tick;
    }));
    ruler.setAttribute('aria-valuemax', String(count));
    $('[data-tl-start]').textContent = '1';
    $('[data-tl-end]').textContent = String(count);
  }

  function renderPlayhead() {
    const total = Math.max(1, state.total);
    const pos = ((state.stepIndex + 0.5) / total) * 100;
    const pct = `${Math.min(100, Math.max(0, pos))}%`;
    playhead.style.left = pct;
    playheadLabel.style.left = pct;
    playheadLabel.textContent = String(state.stepIndex + 1);
    ruler.setAttribute('aria-valuenow', String(state.stepIndex + 1));
    tickHost.querySelectorAll('.tl-tick').forEach((tick, index) => {
      tick.classList.toggle('is-done', index < state.stepIndex);
      tick.classList.toggle('is-current', index === state.stepIndex);
      tick.classList.toggle('is-end', index === state.total - 1);
    });
    $('[data-tl-current]').textContent = String(state.stepIndex + 1);
  }

  function seekFromEvent(event) {
    const rect = ruler.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    const total = Math.max(1, state.total);
    const index = Math.min(total - 1, Math.max(0, Math.floor(ratio * total)));
    onSeek?.(index);
  }
  ruler.addEventListener('pointerdown', seekFromEvent);
  ruler.addEventListener('keydown', (event) => {
    // 时间轴自己处理左右/Home/End 之后必须阻止冒泡：
    // 否则事件会继续冒到 document，宿主的全局快捷键再执行一次 next/prev，一次按键跳过两步（PR #14 复审问题 1）。
    if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); onSeek?.(Math.max(0, state.stepIndex - 1)); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onSeek?.(Math.min(state.total - 1, state.stepIndex + 1)); return; }
    if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); onSeek?.(0); return; }
    if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); onSeek?.(state.total - 1); }
  });

  transport.addEventListener('click', (event) => {
    const button = event.target.closest('[data-t]');
    if (!button) return;
    const action = button.dataset.t;
    if (action === 'reset') onSeek?.(0, { stop: true });
    else if (action === 'last') onSeek?.(Math.max(0, state.total - 1), { stop: true });
    else onTransport?.(action);
  });

  /* ---------------- 对外 ---------------- */
  function bindRun(nextRun) {
    currentRun = nextRun;
    if (!nextRun) return;
    if (viz) viz.destroy();
    viz = createVisualization(vizHost, { run: nextRun, legend: true, dots: true, explainContainer: explainHost });
    runSelect.value = nextRun.runId;
    renderRuler(nextRun.steps.length);
    requestAnimationFrame(fitView);
  }

  function setStep(step, nextState = {}) {
    state = { ...state, ...nextState };
    if (viz && step) viz.showStep(step);
    transport.classList.toggle('is-playing', Boolean(state.playing));
    renderPlayhead();
    const prev = $('[data-t="prev"]');
    const next = $('[data-t="next"]');
    if (prev) prev.disabled = !state.canPrev;
    if (next) next.disabled = !state.canNext;
  }

  renderRuler(run ? run.steps.length : 0);
  if (run) bindRun(run);
  else applyView();

  return {
    el: root,
    setRun: bindRun,
    setStep,
    fitView,
    replay: () => viz?.playEnterAnimation(),
    destroy: () => {
      window.removeEventListener('keydown', onHomeKey);
      window.removeEventListener('keydown', onEsc);
      // 销毁前必须把"全屏"这个页面级状态收干净（PR #14 复审问题 2）：
      // 否则换 run 重建窗口后 body 上仍留着 is-viz-full，panel/panels 的 transform 会被全屏 CSS 压住。
      if (root.dataset.full === 'true' || document.body.classList.contains('is-viz-full')) setFull(false);
      if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
      viz?.destroy();
      root.remove();
    }
  };
}
