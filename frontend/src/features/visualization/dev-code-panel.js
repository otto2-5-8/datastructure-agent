/**
 * 成员03 开发自测页的【代码行联动替身】（dev-only，不是交付功能）
 *
 * 作用：把当前步骤的 lineId 映射到展示源码的某一行，并在那一行上放一个 ▶ 指过去，
 *       用来演示"执行到第 N 步时，可视化上的这一步就指向这段代码"。
 *
 * ================= [02 unsupports] 归属：这是 02 的活，02 还没提供 =================
 * [02 unsupports] 正式产品里"代码面板 + 稳定 lineId 高亮 + left/right/mid 变量面板"属 02 主责
 *   （frontend/src/features/workbench/）；02 的页面壳、挂载点、步骤广播都还没落地。
 *   → 本文件只是 03 为了让动画有东西可联动而写的替身；02 接入后应删除本文件、
 *     改为订阅 02 广播的 stepIndex，不要保留两套高亮实现。
 *
 * ================= [before it happens] 归属与数据都还没就绪 =================
 * [before it happens] 这个面板在正式产品里属【02】的交付项
 *   （docs/team/plan-a-detail.md §4「展示04提供的C/C++代码，通过lineId高亮」、
 *    frontend/src/features/workbench/）。本文件只是 03 开发页里的演示替身，
 *   02 实现正式版时应替换它，不要把它当成生产代码。
 * [before it happens] 正式展示源码与 sourceVersion/lineId 映射属【04】
 *   （docs/architecture/contract-alignment.md C04，目前仍未提案/冻结）。
 *   现在用的是 fixtures/mock-source-lines.json，人工编写，未核验。
 * [before it happens] 变量面板（left/right/mid 数值）同属 02，本替身不画。
 * ==========================================================================
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 创建代码面板。
 * @param {HTMLElement} container 挂载容器
 * @param {{source?: object}} options source = { sourceVersion, language, lines:[{text, lineId?}] }
 * @returns {{highlight: Function, getActiveLineId: Function, destroy: Function}}
 */
export function createCodePanel(container, { source } = {}) {
  if (!container) throw new Error('createCodePanel 需要一个容器元素');
  const lines = Array.isArray(source?.lines) ? source.lines : [];

  const root = el('div', 'bscode');

  const head = el('div', 'bscode-head');
  head.append(el('span', 'bscode-title', source?.title ?? '展示代码'));
  head.append(el('span', 'bscode-badge', source?.mock ? '模拟源码（mock）' : (source?.sourceVersion ?? '未知版本')));
  root.append(head);

  // 行节点只建一次：这样行上的 CSS transition 能在步骤间正常补间，
  // 且"变成当前行"时动画只播一次（不像动画区那样要整帧重建）。
  const marks = [];
  const rows = lines.map((line, index) => {
    const row = el('div', 'bscode-line');
    row.append(el('span', 'bscode-no', String(index + 1)));
    // ▶ 是真实文本节点（不是 CSS ::before），这样"指向哪一行"可以被自检直接断言
    const mark = el('span', 'bscode-mark', '');
    marks.push(mark);
    row.append(mark);
    row.append(el('span', 'bscode-text', line.text));
    if (line.lineId) row.setAttribute('data-line-id', line.lineId);
    return row;
  });
  const list = el('div', 'bscode-lines');
  list.append(...rows);
  root.append(list);

  // lineId → 行号。用 Map 而不是查询 DOM 属性，避免依赖具体属性存储方式。
  // 重复 lineId 是真问题（同一步会指向多行），这里如实报出来。
  const rowIndexByLineId = new Map();
  const duplicateLineIds = [];
  lines.forEach((line, index) => {
    if (!line.lineId) return;
    if (rowIndexByLineId.has(line.lineId)) duplicateLineIds.push(line.lineId);
    else rowIndexByLineId.set(line.lineId, index);
  });
  if (duplicateLineIds.length > 0) {
    root.append(el('p', 'bscode-warn', `⚠ 模拟源码里 lineId 重复：${[...new Set(duplicateLineIds)].join('、')}。同一步会指向多行，正式映射必须 1:1。`));
  }

  const pointer = el('p', 'bscode-pointer');
  root.append(pointer);
  container.append(root);

  let activeLineId = null;

  /**
   * 把当前步骤指向对应代码行。
   * 找不到映射时【明确报出来】，不静默不高亮 —— 否则行映射出错会看不出来。
   */
  function highlight(step) {
    for (const row of rows) row.classList.remove('is-active', 'is-missing');
    for (const mark of marks) mark.textContent = '';
    activeLineId = step?.lineId ?? null;

    if (!step) {
      pointer.textContent = '等待步骤…';
      pointer.className = 'bscode-pointer';
      return;
    }

    const index = rowIndexByLineId.has(activeLineId) ? rowIndexByLineId.get(activeLineId) : -1;
    if (index < 0) {
      pointer.textContent = `⚠ 第 ${step.stepIndex + 1} 步的 lineId="${activeLineId}" 在展示源码里找不到对应行，无法指向。`;
      pointer.className = 'bscode-pointer is-missing';
      return;
    }
    rows[index].classList.add('is-active');
    marks[index].textContent = '▶';
    pointer.textContent = `▶ 第 ${step.stepIndex + 1} 步 → 第 ${index + 1} 行：${lines[index].text.trim()}`;
    pointer.className = 'bscode-pointer';
  }

  function destroy() {
    root.remove();
    rows.length = 0;
    activeLineId = null;
  }

  return { highlight, getActiveLineId: () => activeLineId, destroy };
}
