/**
 * 成员03 开发自测页的【步骤辅导聊天窗口】（dev-only）——DeepSeek 官网那种"输入答题窗口"
 *
 * 结构照 DeepSeek 官网的问答窗口：中间是对话流（用户气泡靠右、辅导/系统消息靠左带头像），
 * 底部是圆角输入区 + 圆形发送按钮，输入区下面一行免责说明；三级提示做成输入区上方的 chips。
 *
 * 两条不许破的规矩：
 *   1) **不伪造模型回答**：默认走真实 POST /api/agent/explain（main 上固定返回 503 MODEL_NOT_CONFIGURED），如实显示错误，
 *      不产生任何 answer 消息。
 *   2) **示例文本必须显眼标注**：另有一个**默认关闭**的「示例文本（非模型输出）」开关。
 *      只有打开它，才用当前步骤的真实数值套模板生成一段说明，并全程标注"模板生成、非模型输出"。
 *      规格允许"人工示意文本"，但要求必须标注、不得当作真实效果对比（plan-a-output-spec §7）。
 *
 * ================= [05 unsupports] 归属：这是 05 的活，05 还没提供 =================
 * [05 unsupports] 步骤辅导（提问、分级提示、出处引用、真实 usage）正式归 05 的
 *   backend/src/agent + frontend/src/features/agent/；服务端 POST /api/agent/explain 现在固定
 *   返回 503 MODEL_NOT_CONFIGURED，前端也没有挂载点。→ 本文件只是 03 开发页的替身。
 * [02 unsupports] 另外：聊天窗口在页面里摆在哪、与可视化如何同一屏联动，属 02 的装配层（C06 待提案），
 *   02 目前没有预留位置。
 *
 * ================= [before it happens] 归属与依赖 =================
 * [before it happens] 步骤辅导在正式产品里属【05】（backend/src/agent、knowledge、
 *   frontend/src/features/agent/）。本文件只是 03 开发页的演示替身，正式实现时应替换。
 * [before it happens] POST /api/agent/explain 在 main 上仍是占位实现（固定 503 MODEL_NOT_CONFIGURED）；模型未配置，
 *   所以不产生任何回答与费用。
 * [before it happens] 06 已合并本批知识卡（其 verified 只表示"本批内容检查"，不代表教材页码核验）；
 *   但 05 的检索 / 引用链 / 真实 usage 还没接入，所以引用区仍显示"无已核验引用"，不编造页码/出处。
 * [before it happens] C06（02 的挂载点与步骤广播）跨成员确认仍待取得，本文件不假定任何已确认的接口。
 * ==================================================================
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 三级辅导的固定问法（契约要求 question 不能为空，所以提示按钮也带问题文本）。 */
export const HINT_LEVELS = [
  { level: 1, name: '观察提示', question: '先给我一条观察提示：这一步该先看什么？' },
  { level: 2, name: '规则提示', question: '再给我规则提示：这一步依据的规则是什么？' },
  { level: 3, name: '完整解释', question: '给我完整解释：结合当前这一步的实际状态说明为什么这样做。' }
];

/** 组装请求体（纯函数，便于自检）。字段口径见 docs/architecture/api-contract.md。 */
export function buildExplainPayload({ runId, stepIndex, question, hintLevel } = {}) {
  return {
    runId,
    stepIndex,
    question: String(question ?? '').trim(),
    hintLevel: Number(hintLevel) || 1
  };
}

const EVENT_TEXT = {
  init: '初始化', probe: '计算并比较中点', 'move-left': '更新左边界',
  'move-right': '更新右边界', found: '找到', 'not-found': '未找到'
};

/**
 * 示例文本（模板生成，**不是模型输出**）。
 * 只把当前步骤的**真实数值**填进固定句式，不复述引擎没给的结论；
 * 调用方必须把它标注为示例文本，不得当作真实模型效果。
 * @param {object} step 当前步骤快照
 * @returns {string}
 */
export function sampleExplanation(step) {
  if (!step) return '（尚未载入步骤，无法生成示例文本。）';
  const { array = [], target, variables = {}, event, result } = step;
  const { left, right, mid } = variables;
  const midText = mid === null || mid === undefined ? '未计算' : `${mid}（A[mid]=${array[mid]}）`;
  const state = `当前 left=${left}、right=${right}、mid=${midText}，目标 ${target}。`;
  switch (event) {
    case 'init':
      return `${state}初始时把整个数组作为候选区间：left 指向 0、right 指向最后一个下标，此时还没有算中点。`;
    case 'probe':
      return `${state}这一步计算中点并与目标比较。规则：数组有序，比较结果决定收窄左半还是右半；mid 本身放在下一轮再判断范围。`;
    case 'move-left':
      return `${state}左边界被更新到 ${left}：下标 0～${left - 1} 已经不可能包含目标，区间收窄为 ${left}～${right}。规则：有序数组中 mid 及其左侧都可以排除。`;
    case 'move-right':
      return `${state}右边界被更新到 ${right}：下标 ${right + 1}～${array.length - 1} 已经不可能包含目标，区间收窄为 ${left}～${right}。规则：有序数组中 mid 及其右侧都可以排除。`;
    case 'found':
      return `${state}命中：目标 ${target} 就在下标 ${result}，查找以左闭右闭区间收敛结束。`;
    case 'not-found':
      return `${state}区间已经为空，说明数组里没有目标 ${target}，因此返回 -1 结束。`;
    default:
      return `${state}事件 ${EVENT_TEXT[event] ?? event}。`;
  }
}

/**
 * 创建步骤辅导聊天窗口。
 * @param {HTMLElement} container
 * @param {object} options
 * @param {(req: {method: string, path: string, body?: object}) => Promise<{status: number, body: any}>} options.request
 */
export function createAgentPanel(container, { request } = {}) {
  if (!container) throw new Error('createAgentPanel 需要一个容器元素');

  const root = el('div', 'agent');

  // 顶部状态条：针对第几步 + 当前区间
  const head = el('div', 'agent-head');
  const target = el('span', 'agent-target');
  const stateLine = el('span', 'agent-state');
  head.append(target, stateLine);
  root.append(head);

  // 示例模式横幅（默认隐藏；打开后全程可见，防止被当成模型输出）
  const sampleBanner = el('p', 'agent-sample-banner', '示例模式已打开：下面的说明由「当前步骤数值 + 固定句式」模板生成，**不是模型输出**，不得作为效果证据。');
  sampleBanner.hidden = true;
  root.append(sampleBanner);

  // 对话流
  const log = el('div', 'agent-log');
  log.setAttribute('role', 'log');
  const column = el('div', 'agent-col');
  log.append(column);
  root.append(log);

  // 底部输入区：提示 chips + 输入框 + 发送
  const composer = el('div', 'agent-composer');
  const hints = el('div', 'agent-hints');
  for (const { level, name, question } of HINT_LEVELS) {
    const btn = el('button', `agent-hint is-${level}`, `提示${level}·${name}`);
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-hint-level', String(level));
    btn.addEventListener('click', () => { send(question, level); });
    hints.append(btn);
  }
  const sampleToggle = el('button', 'agent-sample-toggle', '示例文本（非模型输出）：关');
  sampleToggle.setAttribute('type', 'button');
  sampleToggle.setAttribute('aria-pressed', 'false');
  hints.append(sampleToggle);
  composer.append(hints);

  const inputRow = el('div', 'agent-input-row');
  const input = el('input', 'agent-input');
  input.setAttribute('type', 'text');
  input.setAttribute('placeholder', '给 DeepSeek 式的步骤辅导发消息：为什么下一步要更新 left？');
  input.value = '';
  const sendBtn = el('button', 'agent-send', '↑');
  sendBtn.setAttribute('type', 'button');
  sendBtn.setAttribute('aria-label', '发送');
  inputRow.append(input, sendBtn);
  composer.append(inputRow);

  const disclaimer = el('p', 'agent-disclaimer',
    '内容由尚未接入的模型或示例模板产生，不构成权威解释；执行轨迹以 04 的引擎输出为准。'
    + '（面板属 05；当前接口返回 503、模型未配置、检索与引用链未接入。）');
  composer.append(disclaimer);
  root.append(composer);

  container.append(root);

  let context = { runId: null, stepIndex: null, event: null, description: '', step: null };
  const messages = [];          // 每条消息锁定发送时的 stepIndex，切步骤不改写旧消息
  let sampleMode = false;
  let inFlight = false;
  let seq = 0;

  function appendMessage(kind, { text, stepIndex, meta = '' }) {
    const row = el('div', `agent-msg is-${kind}`);
    const avatar = el('span', 'agent-avatar', kind === 'question' ? '我' : '看');
    const body = el('div', 'agent-body');
    const badge = el('span', 'agent-badge', stepIndex === null ? '全局' : `第 ${stepIndex + 1} 步`);
    body.append(badge, el('span', 'agent-text', text));
    if (meta) body.append(el('span', 'agent-meta', meta));
    row.append(avatar, body);
    column.append(row);
    messages.push({ kind, text, stepIndex, meta });
    return row;
  }

  function setContext(next = {}) {
    context = { ...context, ...next };
    target.textContent = context.stepIndex === null
      ? '针对：—（尚未载入运行）'
      : `针对：第 ${context.stepIndex + 1} 步${context.event ? `（${EVENT_TEXT[context.event] ?? context.event}）` : ''}`;
    stateLine.textContent = context.description || '';
  }

  function setSampleMode(on) {
    sampleMode = Boolean(on);
    sampleBanner.hidden = !sampleMode;
    sampleToggle.textContent = sampleMode ? '示例文本（非模型输出）：开' : '示例文本（非模型输出）：关';
    sampleToggle.classList.toggle('is-on', sampleMode);
    sampleToggle.setAttribute('aria-pressed', String(sampleMode));
    return sampleMode;
  }

  async function send(questionText = input.value ?? '', hintLevel = 1) {
    const question = String(questionText).trim();
    if (question === '') {
      appendMessage('error', { text: '问题不能为空。', stepIndex: context.stepIndex });
      return { status: 'empty-question' };
    }
    if (inFlight) return { status: 'ignored-in-flight' };
    if (!context.runId || context.stepIndex === null) {
      appendMessage('error', { text: '还没有运行中的运行实例，无法定位到某一步。', stepIndex: null });
      return { status: 'no-context' };
    }

    const payload = buildExplainPayload({
      runId: context.runId,
      stepIndex: context.stepIndex,   // ← 锁定提问时的 step
      question,
      hintLevel
    });
    appendMessage('question', { text: question, stepIndex: payload.stepIndex, meta: `hintLevel=${hintLevel}` });
    input.value = '';

    // 示例模式：不请求接口，只输出【明确标注】的模板文本
    if (sampleMode) {
      appendMessage('sample', {
        text: sampleExplanation(context.step),
        stepIndex: payload.stepIndex,
        meta: '示例文本 · 模板生成 · 非模型输出 · 依据：本次运行第 ' + (payload.stepIndex + 1) + ' 步'
      });
      return { status: 'sample-shown', sample: true };
    }

    const mySeq = ++seq;
    inFlight = true;
    sendBtn.disabled = true;
    appendMessage('pending', { text: '正在请求当前步骤的解释…', stepIndex: payload.stepIndex });

    let response;
    try {
      response = await request({ method: 'POST', path: '/api/agent/explain', body: payload });
    } catch (error) {
      response = { status: 0, body: { error: { code: 'NETWORK_ERROR', message: String(error?.message ?? error) } } };
    }
    if (mySeq !== seq) return { status: 'stale' };
    inFlight = false;
    sendBtn.disabled = false;

    const code = response.body?.error?.code ?? 'UNKNOWN';
    const detail = response.body?.error?.message ?? '';

    if (response.status >= 200 && response.status < 300 && response.body?.answer) {
      // 真接上 05 之后走这里：渲染回答并保留原 step 引用
      appendMessage('answer', {
        text: response.body.answer,
        stepIndex: payload.stepIndex,
        meta: `依据：本次运行第 ${payload.stepIndex + 1} 步`
      });
      return { status: 'answered', body: response.body };
    }

    const reason = response.status === 501 || code === 'NOT_IMPLEMENTED'
      ? 'Agent 接口尚未实现（501）。'
      : response.status === 503 || code === 'MODEL_NOT_CONFIGURED'
        ? '模型未配置（MODEL_NOT_CONFIGURED，05 尚未接入 provider）。'
        : `本次解释未完成（${response.status} ${code}），可重试。`;
    appendMessage('error', {
      text: `${reason}${detail ? ` 接口说明：${detail}` : ''}`,
      stepIndex: payload.stepIndex,
      meta: '依据：本次运行第 ' + (payload.stepIndex + 1) + ' 步 · 引用：无已核验引用 · usage：未取得'
    });
    const retry = el('button', 'agent-retry', '重试这次提问');
    retry.setAttribute('type', 'button');
    retry.addEventListener('click', () => { send(question, hintLevel); });
    const retryRow = el('div', 'agent-retry-row');
    retryRow.append(retry);
    column.append(retryRow);
    return { status: 'failed', status_http: response.status, code };
  }

  sendBtn.addEventListener('click', () => { send(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });
  sampleToggle.addEventListener('click', () => { setSampleMode(!sampleMode); });

  appendMessage('system', {
    text: '步骤辅导窗口（开发替身，DeepSeek 式布局）。真实回答需要 05 的适配与已核验知识卡；当前接口返回 503 MODEL_NOT_CONFIGURED，'
      + '因此默认只显示真实错误，不编造解释。要演示窗口效果可打开下面的「示例文本」开关（会全程标注非模型输出）。',
    stepIndex: null
  });

  return {
    setContext,
    send,
    setSampleMode,
    getSampleMode: () => sampleMode,
    getContext: () => ({ ...context }),
    getMessages: () => messages.map((m) => ({ ...m })),
    destroy: () => { root.remove(); }
  };
}
