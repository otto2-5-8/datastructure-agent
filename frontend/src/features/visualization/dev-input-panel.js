/**
 * 成员03 开发自测页的【输入工作台替身】（dev-only）
 *
 * 作用：把"数组 / 目标 → 开始分析"这条输入链路的**校验与反馈**做出来，
 *       并真实调用创建 run 的接口（main 上已实现：正常返回 200 + run），把真实结果/失败如实显示。
 *       成功时会调用传入的 onRun(run) 把 04 产出的 run 交回宿主 —— 这是本替身与宿主的唯一出口。
 *
 * ⚠️ 现状：本文件当前**没有被任何开发页引用**（dev.html / dev-morph.html 都用自己的数据入口）。
 *   保留它只为记录"02 该提供什么"的替身原型；若后续要复用，请按 onRun 回调接管 run 生命周期，
 *   不要把它当成已接入模块（PR #14 复审整理项）。
 *
 * ================= [02 unsupports] 归属：这是 02 的活，02 还没提供 =================
 * [02 unsupports] 数组/目标输入、开始分析、加载与校验/服务失败反馈、以及"调创建接口拿 run"，
 *   正式都属 02（frontend/index.html、app.js、features/workbench/、services/）。
 *   02 目前没有输入工作台、也没有把 run 交给 03 的装配入口。
 *   → 本文件仅是 03 开发页的替身；02 接入后应删除，不要在 03 目录里维护第二套输入校验。
 *
 * ================= [before it happens] 归属与依赖 =================
 * [before it happens] 输入工作台在正式产品里属【02】（frontend/index.html、app.js、
 *   features/workbench/、services/）。本文件只是 03 开发页的演示替身，正式实现时应替换。
 * [before it happens] 轨迹必须来自 04 的引擎（shared/algorithms/binarySearch.js）。main 上接口已实现
 *   （POST /api/algorithms/binary-search/runs 正常返回 run）；本文件刻意【不】自己算二分查找轨迹——
 *   契约明令"前端不另算答案、算法轨迹由确定程序产生、不由模型生成"（structure.md 单一执行来源）。
 *   因此合法输入如果命中 fixtures 里的模拟用例，就切到那条模拟轨迹（明确标注 mock）；
 *   否则只如实报告"接口没有给出可用轨迹"，不编造步骤。
 * [before it happens] 输入上限（数组最大长度、请求字节上限）见 contract-alignment.md C01，
 *   尚未冻结，所以这里不做长度拦截。
 * =================================================================
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const INT_RE = /^[+-]?\d+$/;

/** 把一格的文本解析成安全整数；失败返回 null。 */
function parseIntToken(token) {
  const text = token.trim();
  if (text === '' || !INT_RE.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * 校验并解析输入表单（纯函数，便于自检）。
 * 口径来自 plan-a-output-spec §4：
 *   - 数组框收逗号分隔整数，**明确支持空数组**；非法字符报"数组包含非法数字"；
 *     无序报"数组必须按升序排列"；允许重复值与负整数；**不偷偷排序、不去重**。
 *   - 目标不能为空，**不能自动当成 0**。
 * @returns {{ok: boolean, code?: string, error?: string, array?: number[], target?: number, emptyArray?: boolean}}
 */
export function parseInputForm({ arrayText = '', targetText = '' } = {}) {
  const rawArray = String(arrayText);
  const targetRaw = String(targetText).trim();

  // 目标：空 → 明确报错，绝不默认成 0
  if (targetRaw === '') {
    return { ok: false, code: 'TARGET_EMPTY', error: '目标不能为空；留空不会自动当成 0。' };
  }
  const target = parseIntToken(targetRaw);
  if (target === null) {
    return { ok: false, code: 'TARGET_ILLEGAL', error: '目标必须是整数（允许负数）。' };
  }

  // 数组：整体为空 → 空数组（明确支持）
  const emptyArray = rawArray.trim() === '';
  let array = [];
  if (!emptyArray) {
    const tokens = rawArray.split(/[,，]/).map((t) => t.trim()).filter((t) => t !== '');
    if (tokens.length === 0) {
      return { ok: false, code: 'ARRAY_ILLEGAL_NUMBER', error: '数组包含非法数字：只接受逗号分隔的整数。' };
    }
    array = [];
    for (const token of tokens) {
      const value = parseIntToken(token);
      if (value === null) {
        return { ok: false, code: 'ARRAY_ILLEGAL_NUMBER', error: `数组包含非法数字："${token}"。只接受逗号分隔的整数。` };
      }
      array.push(value);
    }
    for (let i = 1; i < array.length; i += 1) {
      if (array[i] < array[i - 1]) {
        return { ok: false, code: 'ARRAY_NOT_ASCENDING', error: '数组必须按升序排列；不会替你排序或去重。' };
      }
    }
  }

  return { ok: true, array, target, emptyArray };
}

/**
 * 在模拟装置里找一条与输入完全一致的用例（纯函数）。
 * 只做"匹配既有模拟数据"，**不生成轨迹**——生成轨迹是 04 的职责。
 */
export function matchMockRun(runs = [], array = [], target) {
  return runs.find((run) => run.target === target
    && Array.isArray(run.array)
    && run.array.length === array.length
    && run.array.every((v, i) => v === array[i])) ?? null;
}

/**
 * 创建输入工作台。
 * @param {HTMLElement} container
 * @param {object} options
 * @param {(req: {method: string, path: string, body?: object}) => Promise<{status: number, body: any}>} options.request 注入的请求函数（便于自检时不联网）
 * @param {object[]} [options.mockRuns] 模拟用例，命中时切过去演示
 * @param {(run: object) => void} [options.onRunMatched] 命中模拟用例时回调（切到那条轨迹）
 * @param {(run: object) => void} [options.onRun] 真实接口创建成功时回调（宿主用它接管 run 生命周期）
 * @param {(result: object) => void} [options.onValid] 校验通过时回调
 * @returns {{setFeedback: Function, getFeedback: Function, getValues: Function, destroy: Function}}
 */
export function createInputPanel(container, {
  request,
  mockRuns = [],
  onRunMatched = null,
  onRun = null,
  onValid = null
} = {}) {
  if (!container) throw new Error('createInputPanel 需要一个容器元素');

  const root = el('div', 'inp');

  const arrayField = el('label', 'bl-field');
  arrayField.append('数组');
  const arrayInput = el('input', 'inp-array');
  arrayInput.setAttribute('type', 'text');
  arrayInput.setAttribute('placeholder', '1,3,5,7,9（逗号分隔；留空表示空数组）');
  arrayInput.value = '';
  arrayField.append(arrayInput);

  const targetField = el('label', 'bl-field');
  targetField.append('目标');
  const targetInput = el('input', 'inp-target');
  targetInput.setAttribute('type', 'text');
  targetInput.setAttribute('placeholder', '7');
  targetInput.value = '';
  targetField.append(targetInput);

  const fillBtn = el('button', 'bl-btn', '填入示例');
  fillBtn.setAttribute('type', 'button');
  const analyzeBtn = el('button', 'bl-btn is-primary', '开始分析');
  analyzeBtn.setAttribute('type', 'button');

  const feedback = el('span', 'inp-feedback');
  feedback.setAttribute('role', 'status');

  root.append(arrayField, targetField, fillBtn, analyzeBtn, feedback);
  container.append(root);

  let inFlight = false;      // 重复点击守卫：请求在飞时忽略再次点击
  let requestSeq = 0;        // 旧请求隔离：回来的响应若不是最新一次就丢弃
  let feedbackState = { kind: 'idle', text: '' };

  function setFeedback(kind, text) {
    feedbackState = { kind, text };
    feedback.textContent = text;
    feedback.className = `inp-feedback is-${kind}`;
  }

  function getValues() {
    return { arrayText: arrayInput.value ?? '', targetText: targetInput.value ?? '' };
  }

  /** 填入统一案例：只填字段，不自动触发请求。 */
  function fillExample() {
    arrayInput.value = '1,3,5,7,9';
    targetInput.value = '7';
    setFeedback('idle', '已填入统一案例；点“开始分析”才会创建运行。');
  }

  async function analyze() {
    if (inFlight) return { status: 'ignored-in-flight' };   // 重复点击不产生混杂结果
    const parsed = parseInputForm(getValues());
    if (!parsed.ok) {
      setFeedback('error', parsed.error);
      return { status: 'invalid', ...parsed };              // 无效输入不启动播放
    }
    onValid?.(parsed);

    const seq = ++requestSeq;
    inFlight = true;
    analyzeBtn.disabled = true;
    setFeedback('loading', '正在请求创建运行…');

    let response;
    try {
      response = await request({
        method: 'POST',
        path: '/api/algorithms/binary-search/runs',
        body: { array: parsed.array, target: parsed.target }
      });
    } catch (error) {
      if (seq === requestSeq) {
        inFlight = false;
        analyzeBtn.disabled = false;
        setFeedback('error', `请求失败：${error?.message ?? error}。可重试。`);
      }
      return { status: 'network-error' };
    }

    if (seq !== requestSeq) return { status: 'stale' };      // 旧请求结果丢弃，不污染新任务
    inFlight = false;
    analyzeBtn.disabled = false;

    if (response.status >= 200 && response.status < 300 && Array.isArray(response.body?.steps)) {
      setFeedback('ok', `已创建运行 ${response.body.runId}，共 ${response.body.steps.length} 步。`);
      onRun?.(response.body);          // 把真实 run 交给宿主（换 run 时由宿主 destroy 旧实例）
      return { status: 'created', run: response.body };
    }

    // 真实失败：如实说明，绝不用编造的轨迹顶上
    const code = response.body?.error?.code ?? 'UNKNOWN';
    const message = response.body?.error?.message ?? '';
    const matched = matchMockRun(mockRuns, parsed.array, parsed.target);
    if (matched) {
      setFeedback('warn', `接口报错（${response.status} ${code}）${message ? `：${message}` : ''}。`
        + `已切到【模拟数据】${matched.runId} 继续演示（不是真实引擎输出）。`);
      onRunMatched?.(matched);
      return { status: 'mock-fallback', status_http: response.status, code, run: matched };
    }
    setFeedback('error', `接口报错（${response.status} ${code}）${message ? `：${message}` : ''}。`
      + '已保留你的输入，可稍后重试。');
    return { status: 'request-failed', status_http: response.status, code };
  }

  fillBtn.addEventListener('click', fillExample);
  analyzeBtn.addEventListener('click', () => { analyze(); });
  // 输入变化后清掉上一次的结论，避免旧提示挂在新输入上
  arrayInput.addEventListener('input', () => { if (feedbackState.kind !== 'idle') setFeedback('idle', ''); });
  targetInput.addEventListener('input', () => { if (feedbackState.kind !== 'idle') setFeedback('idle', ''); });

  setFeedback('idle', '输入数组与目标后点“开始分析”。');

  return {
    analyze,
    fillExample,
    setFeedback,
    getFeedback: () => ({ ...feedbackState }),
    getValues,
    destroy: () => { root.remove(); }
  };
}
