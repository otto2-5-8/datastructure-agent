/**
 * dev-morph.js — 开发页 v2 的逻辑（原生 ES module，无依赖）
 *
 * 五个功能区共用**同一份步骤数据**（当前 run 的 steps）：
 *   ① 代码显示   —— 当前步骤 → 高亮行 + 变量/区间
 *   ② 算法可视化 —— 直接复用旧 dev.html 那个可视化窗口（dev-viz-window.js：视口平移缩放 + 时间轴 + 本步解释）
 *   ③ 步骤辅导   —— 就当前这一步提问，**直接调 05 在 main 上已实现的 POST /api/agent/explain**：
 *                   成功就展示模型回答 + 步骤引用 + 知识卡出处；503/429/504 等照原样报错号与消息，
 *                   再补一段"由步骤推导的本地规则提示"，绝不伪造模型回答
 *   ④ 过程练习   —— 题目与判分都由步骤数据推导，不让模型打分
 *   ⑤ 本机记录   —— 只写 localStorage，不跨设备、不上传
 *
 * 状态之间的"变形"用弹簧数值积分（参考 branch04/01.css）：
 *   顶栏那枚 24 极径的小标记、切换胶囊的位置/宽度、内容区的横向位移，
 *   都是"目标值一变，弹簧自己追过去"，并按整体速度给一点运动模糊。
 *
 * 数据来源（以 main 为准）：优先用真实引擎 POST /api/algorithms/binary-search/runs 返回的 run
 * （runId / sourceVersion / sourceLines / steps / result），拿不到时才回退 fixtures/*.json 的 mock。
 * 本页只消费 steps，不自己算轨迹。
 * 跨成员确认仍待取得：C06（02 的挂载点与步骤广播）在 contract-alignment.md 里仍是"待提案与联调"。
 */

import { describeStep } from './index.js';
import { createVizWindow } from './dev-viz-window.js';
import { createPlayback } from '../playback/index.js';

const STORE_KEY = 'dsa-dev-morph-log-v1';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EVENT_LABEL = {
  init: '初始化',
  probe: '计算并比较中点',
  'move-left': '更新 left',
  'move-right': '更新 right',
  found: '找到',
  'not-found': '未找到'
};

const VIEW_META = {
  code: '代码显示',
  viz: '算法可视化',
  guide: '步骤辅导',
  quiz: '过程练习',
  log: '本机记录'
};

const VIEW_DESC = {
  code: '当前步骤 → 对应 C/C++ 行、变量与搜索区间。',
  viz: '同一份 steps 的图形视角；「上一步」是真恢复，不是只挪箭头。',
  guide: '就这一步提问：走真实 POST /api/agent/explain；接口不可用时只给按步骤推导的规则提示。',
  quiz: '题目与判分由步骤数据推导（不用模型打分），答错可逐级看提示。',
  log: '练习、提问与案例记录只写在这台机器上，随时可清空。'
};

const SUGGESTS = [
  '为什么下一步要更新 left？',
  'mid 为什么显示「未计算」？',
  '这个区间还可能找到吗？',
  '这一步排除了哪一半？'
];

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const uniq = (list) => list.filter((v, i) => list.indexOf(v) === i);

/* ------------------------------------------------------------------ 状态 */
const state = {
  view: 'code',
  layout: 'split',
  runs: [],
  sourceLines: [],
  codeLines: [],
  run: null,
  stepIndex: 0,
  playback: null,
  vizWindow: null,
  quiz: null,
  quizCursor: 0,
  quizHint: 0,
  guideMode: 'unknown',   // deepseek | mock | disabled | unknown：由 /api/health 决定，不写死
  guideBusy: false
};

/* ------------------------------------------------------------------ 弹簧 */
function makeSpring(value = 0) {
  return { v: value, vel: 0, target: value };
}

function driveSpring(spring, target, stiffness, damping, dt) {
  const force = -stiffness * (spring.v - target) - damping * spring.vel;
  spring.vel += force * dt;
  spring.v += spring.vel * dt;
  return spring;
}

/* ------------------------------------------------------------------ 形变标记
   24 个极径 → 圆滑闭合路径。五个区各有自己的半径剖面：
     代码=方形（超椭圆）/ 可视化=正圆 / 辅导=对话气泡圆角方 / 练习=星形 / 记录=横胶囊 */
const RADIUS_COUNT = 24;
const glyphRadii = Array.from({ length: RADIUS_COUNT }, () => makeSpring(44));
const glyphShift = makeSpring(0);
const glyphScale = makeSpring(1);

function radiiProfile(view) {
  const out = new Array(RADIUS_COUNT);
  for (let i = 0; i < RADIUS_COUNT; i += 1) {
    const a = (i / RADIUS_COUNT) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    if (view === 'code') {
      const k = Math.pow(Math.pow(Math.abs(cos), 4) + Math.pow(Math.abs(sin), 4), -0.25);
      out[i] = 44 * k;
    } else if (view === 'viz') {
      out[i] = 42;
    } else if (view === 'guide') {
      const k = Math.pow(Math.pow(Math.abs(cos), 3) + Math.pow(Math.abs(sin), 3), -1 / 3);
      out[i] = 41 * k;                                   // 圆角方（气泡感）
    } else if (view === 'quiz') {
      out[i] = 38 + 13 * Math.pow(Math.abs(Math.cos(a * 2.5)), 1.5);
    } else {
      out[i] = 26 + 17 * Math.pow(Math.abs(cos), 1.15);
    }
  }
  return out;
}

function radiiToPath(radii, cx = 60, cy = 60) {
  const points = radii.map((r, i) => {
    const a = (i / radii.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const n = points.length;
  const at = (i) => points[(i + n) % n];
  let d = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d} Z`;
}

/* ------------------------------------------------------------------ 切换胶囊 */
const dockPill = { x: makeSpring(0), w: makeSpring(0), ready: false };

function measureDock() {
  const active = $('.tab.is-active');
  if (!active) return;
  const dock = $('#dock');
  const dockBox = dock.getBoundingClientRect();
  const box = active.getBoundingClientRect();
  const x = box.left - dockBox.left;
  if (!dockPill.ready) {
    dockPill.x.v = x;
    dockPill.x.target = x;
    dockPill.w.v = box.width;
    dockPill.w.target = box.width;
    dockPill.ready = true;
    return;
  }
  dockPill.x.target = x;
  dockPill.w.target = box.width;
}

/* ------------------------------------------------------------------ 布局：单区切换 ↔ 三栏同屏
   三栏同屏时「代码显示 + 算法可视化 + 步骤辅导」并排出现在同一屏，练习/记录仍走单区切换。
   过渡：CSS 里按 0/70/140ms 错峰淡入，平台再用位移弹簧给一下"被推过去"的手感。 */
function setLayout(next, { silent = false } = {}) {
  if (!['split', 'triptych'].includes(next)) return;
  const changed = state.layout !== next;
  state.layout = next;
  document.body.dataset.layout = next;

  document.querySelectorAll('.layout-toggle button').forEach((button) => {
    const on = button.dataset.layout === next;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  if (next === 'triptych') {
    // 三栏时把"当前区"停在代码显示：dock 高亮与传输条都跟着它
    setView('code', { silent: true });
  } else {
    const back = ['code', 'viz', 'guide'].includes(state.view) ? state.view : 'code';
    setView(back, { silent: true });
  }

  if (changed && !REDUCED) {
    stageShift.vel += 90;
    glyphScale.vel -= 0.9;
  }
  // 列宽变了，可视化要重新取景，否则数组会溢出窄列（窗口自己不监听容器尺寸）
  requestAnimationFrame(() => state.vizWindow?.fitView());
  setTimeout(() => state.vizWindow?.fitView(), 340);
  if (!silent) toast(next === 'triptych' ? '三栏同屏：代码 / 可视化 / 辅导 并排。' : '单区切换：一次看一个区。');
}

/* ------------------------------------------------------------------ 视图切换 */
const panelsWrap = $('#panels');
const stageShift = makeSpring(0);

function setView(nextView, { silent = false } = {}) {
  if (!VIEW_META[nextView]) return;
  const order = Object.keys(VIEW_META);
  const dir = order.indexOf(nextView) >= order.indexOf(state.view) ? 1 : -1;
  const changed = nextView !== state.view;
  state.view = nextView;

  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.view === nextView;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.view === nextView);
  });

  // 底部传输条只在「代码显示」出现（CSS 用 body[data-view="code"] 控制）
  document.body.dataset.view = nextView;

  measureDock();

  if (changed && !REDUCED) {
    stageShift.vel += dir * 110;
    glyphScale.vel -= 1.1;
    glyphShift.vel += dir * 22;
  }

  if (nextView === 'log') renderLog();
  if (nextView === 'quiz') renderQuiz();
  if (nextView === 'guide') scrollGuideToBottom();

  const desc = $('#view-desc');
  if (desc) desc.textContent = VIEW_DESC[nextView];
}

/* ------------------------------------------------------------------ 数据加载（已对齐 main 接口）
   真实契约（工程 main 已实现）：
     POST /api/algorithms/binary-search/runs  {array, target}
       → { runId, createdAt, algorithm, sourceVersion, sourceLines:[{lineId,text}], steps, result }
       ⚠️ 顶层**没有** array / target / label（数组与目标在每个 step 里）
     GET  /api/runs/:runId                    → 同一个 run
     GET  /api/runs/:runId/steps/:stepIndex   → { runId, step }
     错误：INVALID_INPUT/400、RUN_NOT_FOUND/404、STEP_OUT_OF_RANGE/400
   normalizeRun() 同时吃"真实 run"和本地 fixtures 的 mock（mock 多了 label/array/target，兼容）。
   [02 unsupports] 正式流程里这次调用属 02 的接口调用层，03 只消费它给的 run；
     这里为了能真联调，开发页自己也发一次（仅本地开发页，不进产品）。 */
function normalizeRun(raw) {
  const steps = Array.isArray(raw?.steps) ? raw.steps : [];
  const first = steps[0] || {};
  const sourceLines = Array.isArray(raw?.sourceLines) && raw.sourceLines.length
    ? raw.sourceLines
    : (Array.isArray(first.sourceLines) ? first.sourceLines : []);
  return {
    runId: raw?.runId || first.runId || 'unknown-run',
    label: raw?.label || `${raw?.runId || 'run'} · 真实引擎`,
    algorithm: raw?.algorithm || first.algorithm || 'binary-search',
    sourceVersion: raw?.sourceVersion || first.sourceVersion || '',
    sourceLines,
    steps,
    result: raw?.result ?? null,
    array: raw?.array || first.array || [],
    target: raw?.target ?? first.target ?? null,
    fromApi: Boolean(raw?.runId && !raw.label)
  };
}

/** 试一次真实引擎；不可用（如服务未起/接口变了）就返回 null，绝不编造轨迹。 */
async function fetchRealRun({ array = [1, 3, 5, 7, 9], target = 7 } = {}) {
  try {
    const response = await fetch('/api/algorithms/binary-search/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ array, target })
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const run = normalizeRun(payload);
    return run.steps.length ? run : null;
  } catch {
    return null;
  }
}

async function loadRuns() {
  const [runs, sources] = await Promise.all([
    fetch('./fixtures/mock-runs.json').then((r) => r.json()),
    fetch('./fixtures/mock-source-lines.json').then((r) => r.json())
  ]);
  const mockRuns = (Array.isArray(runs.runs) ? runs.runs : []).map(normalizeRun);
  const real = await fetchRealRun();
  const mockSourceLines = (sources.sources || [])[0]?.lines ?? [];
  return {
    // 真实引擎的 run 排在最前：它才是 main 上现在的接口产物
    runs: real ? [real, ...mockRuns] : mockRuns,
    realAvailable: Boolean(real),
    mockSourceLines
  };
}

function showBootError(message, hint) {
  const box = $('#boot-error');
  box.hidden = false;
  box.replaceChildren(el('b', '', `开发页没能启动：${message}`), el('br'), el('span', '', hint));
}

/* ------------------------------------------------------------------ 代码视图
   [02 unsupports] 这一整段（源码列表、lineId 高亮、变量面板、事件说明）正式属 02 的
   features/workbench/。03 保留它只有一个用途：自测时让"步骤变化 → 代码/变量联动"有东西可看。
   02 接入后，本页应改为订阅 02 广播的 stepIndex，并把这块删掉，不要出现两套高亮实现。
   源码行优先取 run.sourceLines（main 上真实引擎随 run 一起返回，lineId 是 init-left / calc-mid /
   probe-match / update-left …），只有 mock run 没有时才回退到 fixtures/mock-source-lines.json。 */
function renderCodeList() {
  const list = $('#code-list');
  list.replaceChildren(...state.codeLines.map((line, index) => {
    const li = el('li');
    if (line.lineId) li.dataset.lineId = line.lineId;
    li.append(el('span', 'ln', String(index + 1)), el('span', 'tx', line.text));
    return li;
  }));
}

function highlightLine(step) {
  const list = $('#code-list');
  const target = step && step.lineId ? step.lineId : '';
  let matched = false;
  list.querySelectorAll('li').forEach((li) => {
    const on = Boolean(target) && li.dataset.lineId === target;
    li.classList.toggle('is-current', on);
    if (on) matched = true;
  });
  return matched;
}

function variableRows(step) {
  const vars = step && step.variables ? step.variables : {};
  const array = Array.isArray(step?.array) ? step.array : [];
  const midKnown = vars.mid !== null && vars.mid !== undefined;
  const midValue = midKnown ? array[vars.mid] : null;
  const hasRange = vars.left !== undefined && vars.right !== undefined;
  const emptyInterval = hasRange && vars.left > vars.right;

  return [
    ['事件', step ? (EVENT_LABEL[step.event] ?? step.event) : '—'],
    ['left', vars.left ?? '—'],
    ['right', vars.right ?? '—'],
    ['mid', midKnown ? vars.mid : '未计算'],
    ['A[mid]', midKnown && midValue !== undefined ? midValue : '—'],
    ['当前区间', hasRange ? `${vars.left}～${vars.right}${emptyInterval ? '（空区间）' : ''}` : '—'],
    ['target', step?.target ?? '—'],
    ['结果', step?.done ? (step.result === -1 ? '未找到（-1）' : `找到，下标 ${step.result}`) : '未结束']
  ];
}

function fillVars(dl, rows, dropdownIndexes = []) {
  dl.replaceChildren(...rows.flatMap(([key, value], index) => {
    const dt = el('dt', '', key);
    const dd = el('dd', '', String(value));
    if (value === '未计算' || value === '—') dd.classList.add('is-null');
    if (dropdownIndexes.includes(index)) dd.classList.add('is-mono');
    return [dt, dd];
  }));
}

function renderVars(step) {
  fillVars($('#vars'), variableRows(step));
  $('#vars-step').textContent = `第 ${(step ? step.stepIndex : 0) + 1} 步`;
}

function renderEvent(step, matched) {
  const text = step ? describeStep(step) : '还没有步骤';
  $('#code-event').textContent = matched
    ? text
    : `${text}（本步 lineId=${step?.lineId ?? '无'}，模拟源码里没有对应行）`;
}

/* ------------------------------------------------------------------ 步骤辅导
   [05 已实现] 辅导区正式归 05 的 features/agent/；main 上 POST /api/agent/explain 已经能调用
   （真实模型还是 mock，由后端的 AGENT_MOCK / DEEPSEEK_API_KEY 决定）。本页直接发请求：
     · 成功 → 展示 answer + stepRefs + sourceRefs（知识卡出处）+ usage
     · 失败 → 原样展示后端错误码与消息（503 未配置 / 429 限流 / 504 超时 / 404 run 过期），
              再补一段由步骤推导的本地规则提示；**绝不**伪造模型回答
   入参 {runId, stepIndex, question, hintLevel} → 出参 {answer, stepRefs, sourceRefs, usage}。 */
function currentStep() {
  if (!state.run) return null;
  return state.run.steps[state.stepIndex] ?? null;
}

/** 由**真实步骤**推导的本地提示（不是模型生成，也不含任何猜测） */
function localHints(step) {
  if (!step) return ['还没有步骤。'];
  const vars = step.variables || {};
  const array = Array.isArray(step.array) ? step.array : [];
  const out = [];

  if (step.event === 'init') {
    out.push(`初始化：left=${vars.left}、right=${vars.right}，搜索区间是 ${vars.left}～${vars.right}。`);
    out.push('这一步还不计算 mid —— mid 只在「计算并比较中点」那一步才算。');
  } else if (step.event === 'probe') {
    const mid = vars.mid;
    const value = array[mid];
    const relation = value === step.target ? '等于' : (value < step.target ? '小于' : '大于');
    out.push(`mid=${mid}，A[mid]=${value}，target=${step.target} → A[mid] ${relation} target。`);
    if (value === step.target) out.push('两者相等：下一步就会命中，指针不需要再移动。');
    else if (value < step.target) out.push('A[mid] < target：左半（含 mid）整段不可能含目标，下一步会把 left 移到 mid + 1。');
    else out.push('A[mid] > target：右半（含 mid）整段不可能含目标，下一步会把 right 移到 mid - 1。');
  } else if (step.event === 'move-left') {
    out.push(`left 现在变成 ${vars.left}：因为上一轮的 A[mid] 小于 target，mid 及其左边都被排除了。`);
    out.push(`新区间 ${vars.left}～${vars.right}，这一步不计算 mid。`);
  } else if (step.event === 'move-right') {
    out.push(`right 现在变成 ${vars.right}：因为上一轮的 A[mid] 大于 target，mid 及其右边都被排除了。`);
    out.push(`新区间 ${vars.left}～${vars.right}，这一步不计算 mid。`);
  } else if (step.event === 'found') {
    out.push(`命中：target=${step.target} 落在下标 ${step.result}，result=${step.result}。`);
  } else if (step.event === 'not-found') {
    out.push('未找到：区间已经为空（left > right），循环结束，result=-1。');
  }

  if (vars.left !== undefined && vars.right !== undefined) {
    if (vars.left > vars.right) out.push('当前区间为空：再比较也没有元素可以看。');
    else out.push(`区间还剩 ${vars.right - vars.left + 1} 个元素（${vars.left}～${vars.right}）。`);
  }

  return out;
}

function renderGuide(step) {
  $('#guide-step').textContent = `第 ${(step ? step.stepIndex : 0) + 1} 步`;
  const rows = variableRows(step).filter(([key]) => key !== '结果');
  fillVars($('#guide-context'), rows);

  const ul = $('#guide-hints');
  ul.replaceChildren(...localHints(step).map((text) => el('li', '', text)));
}

function messageAi(title, paragraphs, hints, payload) {
  const box = el('div', 'msg msg-ai');
  box.append(el('span', 'tag', title));
  paragraphs.forEach((text) => box.append(el('p', '', text)));

  if (hints && hints.length) {
    const ul = el('ul');
    hints.forEach((text) => ul.append(el('li', '', text)));
    box.append(ul);
  }

  if (payload) {
    const details = el('details');
    details.append(el('summary', '', '请求预览（接后端时会这么发）'));
    const pre = el('pre', '', JSON.stringify(payload, null, 2));
    details.append(pre);
    box.append(details);
  }
  return box;
}

function appendMessage(node) {
  const box = $('#guide-messages');
  box.append(node);
  scrollGuideToBottom();
}

function scrollGuideToBottom() {
  const box = $('#guide-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function guideStatus() {
  const badge = $('#guide-badge');
  if (!badge) return;
  badge.textContent = {
    deepseek: '辅导：真实模型',
    mock: '辅导：Mock 模板',
    disabled: '辅导：模型未配置',
    unknown: '辅导：服务未连接'
  }[state.guideMode] || '辅导：状态未知';
  badge.dataset.mode = state.guideMode;
}

/** 后端能调模型吗？由 /api/health 决定，不在前端写死（同一份页面既能连真实模型也能连 mock） */
async function probeAgent() {
  try {
    const health = await (await fetch('/api/health')).json();
    state.guideMode = health.mode === 'mock' ? 'mock' : (health.modelCallsEnabled ? 'deepseek' : 'disabled');
  } catch (error) {
    state.guideMode = 'unknown';
  }
  guideStatus();
  // 只有还没开始聊时才重画欢迎语，别把用户已经问过的话冲掉
  if (document.querySelectorAll('#guide-messages .msg').length <= 1) welcomeGuide();
  return state.guideMode;
}

function welcomeGuide() {
  const box = $('#guide-messages');
  box.replaceChildren();
  const line = {
    deepseek: '后端已配置真实模型：点提问会把「问题 + 当前步骤 + 知识卡检索」发给 POST /api/agent/explain，回答里带步骤引用与知识卡出处。',
    mock: '后端现在是 AGENT_MOCK=true 的 Mock 模板，回答由后端固定模板生成、不是模型输出；要真实回答请去掉 AGENT_MOCK 并配置 DEEPSEEK_API_KEY。',
    disabled: '后端没配置模型（既没开 Mock 也没配 DEEPSEEK_API_KEY），POST /api/agent/explain 会返回 503；这种情况只给按步骤推导的规则提示。',
    unknown: '还没读到后端 /api/health，辅导接口是否可用未知；提问若失败会原样显示错误。'
  }[state.guideMode];
  appendMessage(messageAi(
    '步骤辅导 · 只谈当前这一步',
    [line, '回答一律绑在当前 run 的当前 stepIndex 上，不会脱离这一步泛泛而谈。']
  ));
}

async function askGuide(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    toast('先写一句想问的话，或点上面的建议问题。');
    return null;
  }
  if (state.guideBusy) {
    toast('上一条还在等回答，稍等一下再问。');
    return null;
  }

  const step = currentStep();
  const input = $('#guide-input');
  if (input) input.value = '';
  appendMessage(el('div', 'msg msg-user', text));
  pushLog({ kind: 'ask', text: `提问：${text}（第 ${state.stepIndex + 1} 步）` });

  // 按 main 上的真实契约组装：POST /api/agent/explain {runId, stepIndex, question, hintLevel}
  const body = {
    runId: state.run ? state.run.runId : null,
    stepIndex: state.stepIndex,
    question: text,
    hintLevel: Math.max(1, Math.min(3, state.guideHintLevel || 1))
  };

  // fixtures 里的 mock 案例不在后端 runs 存储里，发出去必然 404：先说清楚，不演一遍假请求
  if (!body.runId || (state.run && !state.run.fromApi)) {
    appendMessage(messageAi(
      '问不了：这次运行不是真实引擎产生的',
      ['/api/agent/explain 只认后端进程里真实创建过的 runId；当前是 fixtures 里的 mock 案例，后端没有它的步骤记录。',
        '在案例下拉里选带「真实引擎」的那条（run_xxx）再提问。'],
      localHints(step)
    ));
    return body;
  }

  state.guideBusy = true;
  const pending = messageAi('正在问模型…', ['请求已发出，等后端 /api/agent/explain 返回。']);
  appendMessage(pending);
  const startedAt = performance.now();

  try {
    const response = await fetch('/api/agent/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const data = await response.json().catch(() => null);
    pending.remove();

    if (!response.ok) {
      const code = data?.error?.code || `HTTP_${response.status}`;
      const message = data?.error?.message || '后端没有给出可读的错误信息。';
      guideStatus();
      appendMessage(messageAi(
        `接口返回 ${response.status} ${code} · ${elapsedMs} ms`,
        [message, '这是后端原样的错误，不是模型回答。下面是按当前步骤推导出来的本地提示。'],
        localHints(step)
      ));
      return body;
    }

    const usage = data.usage || {};
    const tokens = usage.tokens || usage;
    const metaLine = [
      `模型 ${usage.model || '未知'}`,
      tokens && (tokens.totalTokens ?? tokens.total_tokens) !== undefined
        ? `Token ${tokens.promptTokens ?? tokens.prompt_tokens ?? '?'} / ${tokens.completionTokens ?? tokens.completion_tokens ?? '?'} / ${tokens.totalTokens ?? tokens.total_tokens ?? '?'}`
        : null,
      `耗时 ${elapsedMs} ms`,
      usage.cost === null || usage.cost === undefined ? '费用 未知' : `费用 ${usage.cost}`,
      data.knowledgeUsed === false ? '未用到知识卡' : null
    ].filter(Boolean).join(' · ');

    const box = messageAi(
      usage.mock ? 'Mock 模板回答（不是模型）' : '模型回答 · 就这一步',
      [data.answer || '（后端返回了空回答）']
    );
    box.append(el('p', 'msg-meta', metaLine));

    const refs = Array.isArray(data.stepRefs) ? data.stepRefs : [];
    const sources = Array.isArray(data.sourceRefs) ? data.sourceRefs : [];
    if (refs.length || sources.length) {
      const details = el('details');
      details.append(el('summary', '', `引用：步骤 ${refs.length} 条 / 知识卡 ${sources.length} 条`));
      if (refs.length) {
        const ul = el('ul');
        refs.forEach((ref) => {
          const mid = ref.mid === null || ref.mid === undefined ? '' : ` · mid=${ref.mid}`;
          ul.append(el('li', '', `第 ${(ref.stepIndex ?? 0) + 1} 步 · ${ref.event} · 区间 [${ref.left}, ${ref.right}]${mid}${ref.knowledgeCard ? ` · 卡片 ${ref.knowledgeCard}` : ''}`));
        });
        details.append(ul);
      }
      if (sources.length) {
        const ul = el('ul');
        sources.forEach((src) => ul.append(el('li', '', [src.cardId, src.sourceId, src.chapter, src.pages].filter(Boolean).join(' · '))));
        details.append(ul);
      }
      box.append(details);
    }
    appendMessage(box);
  } catch (error) {
    pending.remove();
    appendMessage(messageAi(
      '请求没发出去',
      [`浏览器层面的失败：${String(error.message || error)}。后端没连上，或请求被拦了。`],
      localHints(step)
    ));
  } finally {
    state.guideBusy = false;
  }
  return body;
}

function renderSuggests() {
  const box = $('#guide-suggests');
  box.replaceChildren(...SUGGESTS.map((text) => {
    const button = el('button', 'suggest', text);
    button.type = 'button';
    button.addEventListener('click', () => askGuide(text));
    return button;
  }));
}

/* ------------------------------------------------------------------ 步骤渲染 */
function renderStep(step, info = {}) {
  const matched = highlightLine(step);
  renderVars(step);
  renderEvent(step, matched);
  renderGuide(step);

  if (state.vizWindow && step) state.vizWindow.setStep(step, info);

  const total = info.total ?? (state.run ? state.run.steps.length : 0);
  const index = step ? step.stepIndex : 0;
  $('#step-count').textContent = `第 ${index + 1} 步 / 共 ${total} 步`;
  $('#step-desc').textContent = step ? describeStep(step) : '暂无步骤';

  $('#prev').disabled = !(info.canPrev ?? index > 0);
  $('#next').disabled = !(info.canNext ?? index < total - 1);
  $('#play').textContent = info.playing ? '暂停' : '播放';
  $('#play').disabled = total === 0;
}

/* ------------------------------------------------------------------ 绑定案例 */
function bindRun(run, { log = true } = {}) {
  if (state.playback) state.playback.destroy();
  if (state.vizWindow) state.vizWindow.destroy();

  state.run = run;
  state.stepIndex = 0;

  // 代码列：优先用 run.sourceLines（真实引擎随 run 一起给的 13 行），否则回退 mock 源码
  state.codeLines = run.sourceLines.length ? run.sourceLines : state.sourceLines;
  renderCodeList();
  $('#code-version').textContent = `${run.sourceVersion || 'sourceVersion —'} · `
    + `${state.codeLines.length} 行 · ${run.sourceLines.length ? 'run.sourceLines（main 接口）' : 'fixtures/mock-source-lines.json（mock）'}`;

  // 数据来源徽标要随选中的 run 变（真实接口 / mock），不能写死（PR #14 复审整理项）
  const badge = $('#mode-badge');
  if (badge) {
    badge.textContent = run.fromApi ? `真实引擎 ${run.sourceVersion || ''}`.trim() : 'mock 数据';
    badge.dataset.source = run.fromApi ? 'api' : 'mock';
  }

  // 可视化窗口：视口 / 时间轴 / 本步解释都是它自己的，这里只把宿主与回调给它
  state.vizWindow = createVizWindow($('#vizwin-host'), {
    runs: state.runs,
    run,
    speedMs: Number($('#speed').value),
    onSelectRun: (runId) => {
      const next = state.runs.find((item) => item.runId === runId);
      if (!next) return;
      const select = $('#run-select');
      if (select) select.value = next.runId;
      bindRun(next);
    },
    onSpeedChange: (ms) => {
      const select = $('#speed');
      if (select) select.value = String(ms);
      if (state.playback) state.playback.setSpeed(ms);
    },
    onSeek: (index, options = {}) => seekTo(index, options),
    onTransport: (action) => {
      if (!state.playback) return;
      if (action === 'play') state.playback.play();
      else if (action === 'pause') state.playback.pause();
      else if (action === 'prev') state.playback.prev();
      else if (action === 'next') state.playback.next();
    }
  });
  wireWindowDrag();

  state.playback = createPlayback({
    runId: run.runId,
    steps: run.steps,
    intervalMs: Number($('#speed').value),
    onStepChange: (info) => {
      state.stepIndex = info.stepIndex;
      renderStep(info.step, info);
    }
  });

  renderStep(run.steps[0] ?? null, {
    total: run.steps.length,
    canPrev: false,
    canNext: run.steps.length > 1,
    playing: false
  });

  state.quiz = buildQuiz(run);
  state.quizCursor = 0;
  state.quizHint = 0;
  renderQuiz();

  welcomeGuide();
  renderSuggests();

  if (log) pushLog({ kind: 'case', text: `切换案例：${run.label || run.runId}` });
}

/* ------------------------------------------------------------------ 过程练习
   [07 unsupports] 练习区正式归 07 的 features/exercises/（题库来自 06、判分走 04、三级提示与解析归 07）。
   这里的三道题与判分只是按 step 数据现算的替身，**不要**把这套判分当成产品逻辑。 */
function buildQuiz(run) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const questions = [];
  const optionSet = (answer, candidates) => {
    const list = uniq([answer, ...candidates]).slice(0, 4);
    const shift = (run.runId || '').length % list.length;
    return list.slice(shift).concat(list.slice(0, shift));
  };

  const LEFT_EVENTS = ['move-left', 'update-left'];
  const leftIndex = steps.findIndex((s) => LEFT_EVENTS.includes(s.event));
  if (leftIndex > 0) {
    const step = steps[leftIndex];
    const left = step.variables.left;
    questions.push({
      q: `第 ${leftIndex + 1} 步「更新 left」之后，left 等于多少？`,
      options: optionSet(left, [left + 1, Math.max(0, left - 1), step.variables.right]),
      answer: left,
      hints: [
        '先看这一步的上一个 mid 落在哪，被切掉的是左半还是右半。',
        '闭区间二分：确定丢掉左半之后，left 会移动到 mid + 1。',
        `本题答案：left = ${left}（区间变成 ${step.variables.left}～${step.variables.right}）。`
      ]
    });
  }

  const probeIndex = steps.findIndex((s) => s.event === 'probe' && s.variables.mid !== null);
  if (probeIndex >= 0) {
    const step = steps[probeIndex];
    const mid = step.variables.mid;
    const naive = Math.floor((step.variables.left + step.variables.right) / 2);
    questions.push({
      q: `第 ${probeIndex + 1} 步算出的 mid 是几？（数组 [${step.array.join(',')}]，target ${step.target}）`,
      options: optionSet(mid, [mid + 1, naive === mid ? mid + 2 : naive, step.variables.right]),
      answer: mid,
      hints: [
        'mid 不是随便取的，它是当前左右端点的中点（向下取整）。',
        `当前区间 ${step.variables.left}～${step.variables.right}，取中点得到 ${mid}。`,
        `本题答案：mid = ${mid}，A[mid] = ${step.array[mid]}。`
      ]
    });
  }

  const last = steps[steps.length - 1];
  if (last) {
    const answer = last.result === -1 ? '未找到（-1）' : `找到，下标 ${last.result}`;
    questions.push({
      q: '这次搜索最终的结果是？',
      options: optionSet(answer, ['未找到（-1）', '找到，下标 0', `找到，下标 ${last.array.length - 1}`]),
      answer,
      hints: [
        '看最后一步的 done 与 result。',
        'result = -1 表示未找到；否则就是目标所在下标。',
        `本题答案：${answer}。`
      ]
    });
  }

  return { questions, score: 0, answered: 0, locked: false };
}

function renderQuiz() {
  const quiz = state.quiz;
  if (!quiz || quiz.questions.length === 0) {
    $('#quiz-q').textContent = '这个案例暂时出不了题。';
    $('#quiz-opts').replaceChildren();
    return;
  }
  const cursor = state.quizCursor ?? 0;
  const finished = cursor >= quiz.questions.length;

  $('#quiz-progress').textContent = finished
    ? `已完成 ${quiz.questions.length} 题`
    : `第 ${cursor + 1} / ${quiz.questions.length} 题`;
  $('#quiz-score').textContent = `正确 ${quiz.score} / 已答 ${quiz.answered}`;

  const opts = $('#quiz-opts');
  opts.replaceChildren();

  if (finished) {
    $('#quiz-q').textContent = `这一轮做完啦：${quiz.score} / ${quiz.questions.length} 答对。`;
    $('#quiz-fb').textContent = quiz.score === quiz.questions.length
      ? '全对。可以切到「代码显示」再走一遍步骤，或「重做」换一组题序。'
      : '答错的题已经记进「本机记录」，回去看看是哪一步的判断出了问题。';
    $('#quiz-fb').className = 'quiz-fb';
    $('#quiz-next').disabled = true;
    return;
  }

  const question = quiz.questions[cursor];
  $('#quiz-next').disabled = false;
  $('#quiz-q').textContent = question.q;
  $('#quiz-fb').textContent = '';
  $('#quiz-fb').className = 'quiz-fb';
  state.quizHint = 0;

  question.options.forEach((option, index) => {
    const button = el('button', 'quiz-opt');
    button.type = 'button';
    button.append(el('span', 'tag', String.fromCharCode(65 + index)), el('span', '', String(option)));
    button.addEventListener('click', () => answerQuiz(option, button));
    opts.append(button);
  });
}

function answerQuiz(option, button) {
  const quiz = state.quiz;
  const cursor = state.quizCursor ?? 0;
  const question = quiz && quiz.questions[cursor];
  if (!question || quiz.locked) return;
  quiz.locked = true;

  const correct = option === question.answer;
  quiz.answered += 1;
  if (correct) quiz.score += 1;

  $('#quiz-opts').querySelectorAll('.quiz-opt').forEach((node) => {
    node.disabled = true;
    if (node.lastChild.textContent === String(question.answer)) node.classList.add('is-correct');
  });
  if (!correct) button.classList.add('is-wrong');

  const fb = $('#quiz-fb');
  fb.className = `quiz-fb ${correct ? 'is-ok' : 'is-bad'}`;
  fb.textContent = correct
    ? `答对了。${question.hints[2]}`
    : `答错了。正确答案：${question.answer}。点「看提示」可以看推理过程。`;

  $('#quiz-score').textContent = `正确 ${quiz.score} / 已答 ${quiz.answered}`;
  pushLog({
    kind: 'quiz',
    ok: correct,
    text: `${question.q} → 选择「${option}」，${correct ? '正确' : `应为「${question.answer}」`}`
  });

  quiz.locked = false;
}

/* ------------------------------------------------------------------ 本机记录
   [07 unsupports] 记录区正式归 07 的 features/records/：存储键要带版本、字段关联题目/主题、
   清除要有效。这里的 localStorage 与字段都是替身，07 定下键名/结构后应整体替换。 */
function readLog() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[dev-morph] 本机记录读取失败，按空记录处理：', error);
    return [];
  }
}

function pushLog(entry) {
  const list = readLog();
  list.push({ t: Date.now(), ...entry });
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-200)));
  } catch (error) {
    console.warn('[dev-morph] 本机记录写入失败（可能是隐私模式）：', error);
  }
  if (state.view === 'log') renderLog();
}

const LOG_LABEL = { quiz: '练习', case: '案例', ask: '提问' };

function renderLog() {
  const list = readLog().slice().reverse();
  const quiz = list.filter((x) => x.kind === 'quiz');
  const right = quiz.filter((x) => x.ok).length;

  const summary = $('#log-summary');
  summary.replaceChildren(
    stat(String(quiz.length ? Math.round((right / quiz.length) * 100) : 0) + '%', '练习正确率'),
    stat(`${right} / ${quiz.length}`, '答对 / 已答'),
    stat(String(list.filter((x) => x.kind === 'ask').length), '提问次数'),
    stat(String(list.length), '记录条数')
  );

  const body = $('#log-body');
  if (list.length === 0) {
    body.replaceChildren(el('p', 'log-empty',
      '还没有记录。\n切一个案例、答几道题、或者就某一步提个问，这里就会出现。\n（只写在本机 localStorage，不上传）'));
    return;
  }

  body.replaceChildren(...list.slice(0, 60).map((entry) => {
    const row = el('div', 'log-row');
    if (entry.kind === 'quiz') row.classList.add(entry.ok ? 'is-ok' : 'is-bad');
    row.append(
      el('span', 't', new Date(entry.t).toLocaleTimeString('zh-CN', { hour12: false })),
      el('span', 'k', LOG_LABEL[entry.kind] || '记录'),
      el('span', '', entry.text)
    );
    return row;
  }));
}

function stat(value, label) {
  const box = el('div', 'log-stat');
  box.append(el('b', '', value), el('span', '', label));
  return box;
}

/* ------------------------------------------------------------------ 提示条 */
let toastTimer = null;
function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { node.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ 渲染循环 */
let lastTime = performance.now();
let booted = false;

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.032);
  lastTime = now;

  const targets = radiiProfile(state.view);
  let speedSum = 0;

  for (let i = 0; i < RADIUS_COUNT; i += 1) {
    const spring = glyphRadii[i];
    if (REDUCED) {
      spring.v = targets[i];
      spring.vel = 0;
    } else {
      driveSpring(spring, targets[i], 175, 22, dt);
    }
    speedSum += Math.abs(spring.vel);
  }

  if (REDUCED) {
    glyphScale.v = 1;
    glyphShift.v = 0;
    stageShift.v = 0;
    dockPill.x.v = dockPill.x.target;
    dockPill.w.v = dockPill.w.target;
  } else {
    driveSpring(glyphScale, 1, 210, 19, dt);
    driveSpring(glyphShift, 0, 140, 20, dt);
    driveSpring(stageShift, 0, 120, 18, dt);
    // 胶囊跟得更紧一点：位移/宽度用更硬的弹簧，避免标签在滑动过程中"半蓝半白"
    driveSpring(dockPill.x, dockPill.x.target, 300, 30, dt);
    driveSpring(dockPill.w, dockPill.w.target, 300, 30, dt);
    // 收尾吸附：弹簧永远差几十分之一像素会让"半个标签在胶囊外"，这里直接归位
    if (Math.abs(dockPill.x.v - dockPill.x.target) < 0.4 && Math.abs(dockPill.x.vel) < 1.2) {
      dockPill.x.v = dockPill.x.target;
      dockPill.x.vel = 0;
    }
    if (Math.abs(dockPill.w.v - dockPill.w.target) < 0.4 && Math.abs(dockPill.w.vel) < 1.2) {
      dockPill.w.v = dockPill.w.target;
      dockPill.w.vel = 0;
    }
  }

  const path = $('#glyph-path');
  if (path) path.setAttribute('d', radiiToPath(glyphRadii.map((s) => s.v)));

  const glyph = $('#glyph');
  if (glyph) {
    const blur = Math.min(speedSum / 2600, 0.6);
    glyph.style.transform = `translateX(${glyphShift.v.toFixed(2)}px) scale(${glyphScale.v.toFixed(3)})`;
    glyph.style.filter = blur > 0.04 ? `blur(${blur.toFixed(2)}px)` : 'none';
  }

  const pill = $('#dock-pill');
  if (pill) {
    pill.style.width = `${Math.max(0, dockPill.w.v).toFixed(1)}px`;
    pill.style.transform = `translateX(${dockPill.x.v.toFixed(1)}px)`;
  }
  if (panelsWrap) panelsWrap.style.transform = `translateX(${stageShift.v.toFixed(2)}px)`;

  window.requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ 可移动窗口
   可视化窗口（.vizwin）按住标题栏就能拖、右下角可缩放，拖出工作区会被夹住。
   「最大化 / 复位窗口」两个按钮由 dev-viz-window.js 自己处理几何，这里只管拖动。
   因为窗口是每次切案例重建的，所以绑定函数在 bindRun() 里对新建的窗口重新调用一次。 */
function wireWindowDrag() {
  const stage = $('#stage');
  const win = $('#vizwin-host .vizwin');
  if (!win || win.dataset.dragWired === 'true') return;
  win.dataset.dragWired = 'true';

  const bar = win.querySelector('.win-bar');
  if (!bar) return;

  const stageBox = () => stage.getBoundingClientRect();
  let zTop = 10;
  const bringToFront = () => { zTop += 1; win.style.zIndex = String(zTop); };

  win.addEventListener('pointerdown', bringToFront, true);

  bar.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, select')) return;
    // 三栏同屏时窗口是"一列铺满"，拖动会把列布局掰坏，直接不响应
    if (document.body.dataset.layout === 'triptych') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const box = win.getBoundingClientRect();
    const origin = stageBox();
    const start = { x: event.clientX, y: event.clientY, left: box.left, top: box.top };

    // 夹取范围：窗口比工作区小 → 必须完整留在工作区里；比工作区大 → 至少留 140×44 可见
    const minGapX = Math.min(0, origin.width - box.width);
    const maxGapX = Math.max(0, origin.width - box.width);
    const minGapY = Math.min(0, origin.height - box.height);
    const maxGapY = Math.max(0, origin.height - box.height);

    // 先把当前几何固化成 px，否则 width:84% 会让 left/top 无意义
    win.style.width = `${box.width}px`;
    win.style.height = `${box.height}px`;
    win.style.left = `${box.left - origin.left}px`;
    win.style.top = `${box.top - origin.top}px`;
    win.dataset.fitted = 'false';
    win.classList.add('is-dragging');
    bringToFront();

    const move = (ev) => {
      const nextLeft = start.left - origin.left + (ev.clientX - start.x);
      const nextTop = start.top - origin.top + (ev.clientY - start.y);
      win.style.left = `${Math.max(minGapX, Math.min(maxGapX, nextLeft))}px`;
      win.style.top = `${Math.max(minGapY, Math.min(maxGapY, nextTop))}px`;
    };
    const end = () => {
      win.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    // 监听挂在 window 上：指针离开标题栏也继续跟手
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    event.preventDefault();
  });
}

/* ------------------------------------------------------------------ 拖动进度条 = 跳到某一步
   playback 没有 seek 接口（也不该有），这里用 next/prev 走到目标步；步数很少（≤8），代价可忽略。 */
function seekTo(index, { stop = true } = {}) {
  if (!state.playback) return;
  const total = state.run ? state.run.steps.length : 0;
  if (total === 0) return;
  const target = Math.max(0, Math.min(total - 1, index));
  if (stop) state.playback.pause();

  let guard = 0;
  while (state.stepIndex < target && guard < 64) { state.playback.next(); guard += 1; }
  while (state.stepIndex > target && guard < 64) { state.playback.prev(); guard += 1; }
}

/* ------------------------------------------------------------------ 事件接线 */
function wireEvents() {
  $('#dock').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) setView(tab.dataset.view);
  });

  $('#layout-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-layout]');
    if (button) setLayout(button.dataset.layout);
  });

  $('#prev').addEventListener('click', () => state.playback && state.playback.prev());
  $('#next').addEventListener('click', () => state.playback && state.playback.next());
  $('#reset').addEventListener('click', () => {
    if (!state.playback) return;
    state.playback.reset();
    state.vizWindow?.replay();
  });
  $('#play').addEventListener('click', () => {
    if (!state.playback) return;
    const info = state.playback.getState();
    if (info.playing) state.playback.pause();
    else state.playback.play();
  });

  $('#speed').addEventListener('change', (event) => {
    if (state.playback) state.playback.setSpeed(Number(event.target.value));
  });

  $('#run-select').addEventListener('change', (event) => {
    const run = state.runs.find((item) => item.runId === event.target.value);
    if (run) bindRun(run);
  });

  // 步骤辅导：提问 + 快捷问题
  $('#guide-send').addEventListener('click', () => askGuide($('#guide-input').value));
  $('#guide-input').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      askGuide($('#guide-input').value);
    }
  });

  $('#quiz-next').addEventListener('click', () => {
    if (!state.quiz) return;
    const cursor = state.quizCursor ?? 0;
    if (cursor >= state.quiz.questions.length) return;
    state.quizCursor = cursor + 1;
    renderQuiz();
  });

  $('#quiz-hint').addEventListener('click', () => {
    const quiz = state.quiz;
    if (!quiz) return;
    const question = quiz.questions[state.quizCursor ?? 0];
    if (!question) return;
    state.quizHint = Math.min((state.quizHint ?? 0) + 1, question.hints.length);
    const fb = $('#quiz-fb');
    fb.className = 'quiz-fb';
    fb.textContent = `提示 ${state.quizHint}/${question.hints.length}：${question.hints[state.quizHint - 1]}`;
  });

  $('#quiz-restart').addEventListener('click', () => {
    if (!state.run) return;
    state.quiz = buildQuiz(state.run);
    state.quizCursor = 0;
    renderQuiz();
  });

  $('#log-clear').addEventListener('click', () => {
    if (!window.confirm('清空本机记录？这个动作不能撤销。')) return;
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch (error) {
      console.warn('[dev-morph] 清空失败：', error);
    }
    renderLog();
    toast('本机记录已清空。');
  });

  window.addEventListener('resize', () => {
    measureDock();
    state.vizWindow?.fitView();   // 视口尺寸变了要重新取景
  });

  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    // 局部处理器（时间轴 / 窗口）已经处理过的按键不再重复执行一次（PR #14 复审问题 1）
    if (event.defaultPrevented) return;

    const order = Object.keys(VIEW_META);
    if (['1', '2', '3', '4', '5'].includes(event.key)) {
      setView(order[Number(event.key) - 1]);
      return;
    }
    if (event.key === 'ArrowRight') { state.playback && state.playback.next(); return; }
    if (event.key === 'ArrowLeft') { state.playback && state.playback.prev(); return; }
    if (event.key === 't' || event.key === 'T') {
      setLayout(state.layout === 'triptych' ? 'split' : 'triptych');
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (!state.playback) return;
      const info = state.playback.getState();
      if (info.playing) state.playback.pause();
      else state.playback.play();
    }
  });
}

/* ------------------------------------------------------------------ 启动 */
async function boot() {
  wireEvents();
  window.requestAnimationFrame(frame);

  try {
    const loaded = await loadRuns();
    state.runs = loaded.runs;
    state.sourceLines = loaded.mockSourceLines;
    state.realAvailable = loaded.realAvailable;

    if (state.runs.length === 0) throw new Error('既没拿到真实 run，fixtures/mock-runs.json 里也没有 runs');

    const select = $('#run-select');
    select.replaceChildren(...state.runs.map((run) => {
      const option = el('option', '', run.label || run.runId);
      option.value = run.runId;
      return option;
    }));

    const legend = $('.vars-legend');
    if (legend) {
      legend.replaceChildren();
      legend.append(el('b', '', '[before it happens] '));
      legend.append(document.createTextNode(
        loaded.realAvailable
          ? '源码行来自 run.sourceLines（POST /api/algorithms/binary-search/runs 的真实返回，sourceVersion = '
            + (state.runs[0].sourceVersion || '—') + '）；'
          : '没连上真实引擎，源码行用 fixtures/mock-source-lines.json（mock）；'
      ));
      legend.append(document.createTextNode('代码面板正式归 02，本页这份只是自测替身。'));
    }

    bindRun(state.runs[0]);
    setView('code', { silent: true });
    setLayout('split', { silent: true });
    measureDock();
    booted = true;

    // 辅导接口的能力由后端决定：先读 /api/health，再决定徽标与欢迎语（不阻塞首屏）
    probeAgent().catch((error) => console.warn('[dev-morph] 读 /api/health 失败：', error));
  } catch (error) {
    console.error('[dev-morph] 启动失败：', error);
    showBootError(
      String(error.message || error),
      '这个页面用 fetch 读 fixtures/*.json，必须通过后端服务打开：在项目根执行 npm start，'
      + '然后访问 http://127.0.0.1:3000/src/features/visualization/dev-morph.html（file:// 直接双击会被 CORS 拦掉）。'
    );
  }
}

boot();

// 供自检脚本读取，不参与界面
window.__devMorph = {
  getState: () => ({
    view: state.view,
    booted,
    runId: state.run ? state.run.runId : null,
    stepIndex: state.stepIndex,
    total: state.run ? state.run.steps.length : 0,
    quizScore: state.quiz ? state.quiz.score : 0,
    quizAnswered: state.quiz ? state.quiz.answered : 0,
    logCount: readLog().length,
    guideMessages: document.querySelectorAll('#guide-messages .msg').length
  }),
  setView,
  setLayout,
  ask: askGuide,
  /** 接口对齐自检用：当前 run 的来源与源码行、以及真实引擎是否可用 */
  runProbe: () => ({
    realAvailable: state.realAvailable,
    agentMode: state.guideMode,
    runId: state.run ? state.run.runId : null,
    fromApi: Boolean(state.run && state.run.fromApi),
    label: state.run ? state.run.label : null,
    sourceVersion: state.run ? state.run.sourceVersion : null,
    codeLineCount: state.codeLines.length,
    codeLineIds: state.codeLines.filter((l) => l.lineId).map((l) => l.lineId),
    stepLineIds: state.run ? state.run.steps.map((s) => s.lineId) : [],
    currentLineId: (() => {
      const cur = document.querySelector('#code-list li.is-current');
      return cur ? cur.dataset.lineId : null;
    })(),
    currentLineText: (() => {
      const cur = document.querySelector('#code-list li.is-current');
      return cur ? cur.textContent : null;
    })()
  }),
  winGeom: () => Array.prototype.map.call(document.querySelectorAll('.vizwin'), (win) => {
    const box = win.getBoundingClientRect();
    return {
      view: win.dataset.win,
      left: Math.round(box.left),
      top: Math.round(box.top),
      width: Math.round(box.width),
      height: Math.round(box.height),
      inlineLeft: win.style.left,
      inlineTop: win.style.top,
      fitted: win.dataset.fitted === 'true'
    };
  }),
  vizProbe: () => {
    const win = document.querySelector('.vizwin');
    if (!win) return null;
    const scene = win.querySelector('[data-viz-scene]');
    return {
      hasViewport: Boolean(win.querySelector('[data-viz-body]')),
      sceneTransform: scene ? getComputedStyle(scene).transform : null,
      gridFineOpacity: win.querySelector('[data-grid="fine"]')?.style.opacity ?? '',
      explainVisible: Boolean(win.querySelector('[data-explain-host] .bsviz-explain')),
      cells: win.querySelectorAll('.bsviz-cell').length,
      ticks: win.querySelectorAll('.tl-tick').length,
      current: win.querySelector('[data-tl-current]')?.textContent,
      end: win.querySelector('[data-tl-end]')?.textContent,
      playheadLeft: win.querySelector('[data-tl-playhead]')?.style.left,
      hint: win.querySelector('.viewport-hint')?.textContent
    };
  }
};
