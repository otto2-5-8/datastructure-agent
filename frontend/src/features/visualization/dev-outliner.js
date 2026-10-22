/**
 * 成员03 开发自测页的【场景集合大纲】（dev-only）
 *
 * 作用：把原来挤在视口里的图例（L/R/M/区间/已排除）搬到右栏，按 Blender 大纲
 *       （场景集合）的样子以"可折叠树 + 每行 符号/名称/当前值"呈现，
 *       并跟着当前步骤实时更新——它同时承担"图例说明"和"当前场景状态"两件事。
 *
 * ================= [before it happens] 归属 =================
 * [before it happens] 这是 03 开发页的演示元素，不是产品交付项。正式页面里
 *   符号图例与变量面板归 02（frontend/src/features/workbench/），
 *   且真实数值应来自 04 的 run/steps。当前数值全部来自 fixtures 里的模拟步骤。
 * =============================================================
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 创建大纲。
 * @param {HTMLElement} container 挂载容器
 * @param {{run?: object}} options run 提供 array/steps
 * @returns {{update: Function, getGroups: Function, destroy: Function}}
 */
export function createOutliner(container, { run } = {}) {
  if (!container) throw new Error('createOutliner 需要一个容器元素');

  const root = el('div', 'ol-root');
  const head = el('div', 'ol-head');
  head.append(el('span', 'ol-title', '场景集合'));
  head.append(el('span', 'ol-badge', run?.mock ? 'mock' : (run?.sourceVersion ?? '')));
  root.append(head);

  /** 一行：可选的符号徽标 + 名称 + 右侧当前值。 */
  function itemRow({ key, mark, markClass = '', name, hint = '' }) {
    const row = el('div', 'ol-item');
    row.setAttribute('data-key', key);
    const m = el('span', `ol-mark ${markClass}`.trim(), mark ?? '');
    const nameEl = el('span', 'ol-name', name);
    if (hint) nameEl.append(el('i', 'ol-hint', hint));
    const value = el('span', 'ol-value', '—');
    row.append(m, nameEl, value);
    return { row, value };
  }

  /** 一个可折叠分组：分组头（▼ 名称）＋ 组内行。 */
  function group({ key, name }) {
    const groupRow = el('div', 'ol-group');
    groupRow.setAttribute('data-group', key);
    const tri = el('span', 'ol-tri', '▼');
    groupRow.append(tri, el('span', 'ol-group-name', name));
    const items = el('div', 'ol-items');
    items.setAttribute('data-for', key);
    groupRow.addEventListener('click', () => {
      const collapsed = items.classList.contains('is-collapsed');
      items.classList.toggle('is-collapsed', !collapsed);
      tri.textContent = collapsed ? '▼' : '▶';
      groupRow.setAttribute('aria-expanded', String(collapsed));
    });
    groupRow.setAttribute('aria-expanded', 'true');
    root.append(groupRow, items);
    return { items, tri };
  }

  // ---- 数组 ----
  const arrayGroup = group({ key: 'array', name: '数组' });
  const arrayRow = itemRow({ key: 'array', mark: '▦', name: '元素', hint: 'array' });
  arrayGroup.items.append(arrayRow.row);

  // ---- 指针（这部分就是图例：符号 + 含义 + 当前值） ----
  const ptrGroup = group({ key: 'pointers', name: '指针' });
  const leftRow = itemRow({ key: 'left', mark: 'L', markClass: 'is-l', name: '左边界', hint: 'left' });
  const rightRow = itemRow({ key: 'right', mark: 'R', markClass: 'is-r', name: '右边界', hint: 'right' });
  const midRow = itemRow({ key: 'mid', mark: 'M', markClass: 'is-m', name: '中点', hint: 'mid' });
  ptrGroup.items.append(leftRow.row, rightRow.row, midRow.row);

  // ---- 区间 ----
  const rangeGroup = group({ key: 'range', name: '搜索区间' });
  const rangeRow = itemRow({ key: 'range', mark: '▣', markClass: 'is-range', name: '当前区间', hint: '[left, right]' });
  const excludedRow = itemRow({ key: 'excluded', mark: '▢', markClass: 'is-dim', name: '已排除（变淡）', hint: '落在区间外' });
  rangeGroup.items.append(rangeRow.row, excludedRow.row);

  // ---- 结果 ----
  const resultGroup = group({ key: 'result', name: '结果' });
  const eventRow = itemRow({ key: 'event', mark: '◆', name: '当前事件' });
  const outcomeRow = itemRow({ key: 'outcome', mark: '★', name: '最终结果' });
  resultGroup.items.append(eventRow.row, outcomeRow.row);

  container.append(root);

  const EVENT_TEXT = {
    init: '初始化', probe: '计算并比较中点', 'move-left': '更新左边界',
    'move-right': '更新右边界', found: '找到', 'not-found': '未找到'
  };

  function setValue(entry, text, off = false) {
    entry.value.textContent = text;
    entry.row.classList.toggle('is-off', off);
  }

  /**
   * 按当前步骤刷新。null / 未计算必须显示成"未计算"，不能显示 0（契约要求）。
   */
  function update(step) {
    if (!step) {
      setValue(arrayRow, '—', true);
      setValue(leftRow, '—', true);
      setValue(rightRow, '—', true);
      setValue(midRow, '未计算', true);
      setValue(rangeRow, '—', true);
      setValue(excludedRow, '—', true);
      setValue(eventRow, '—', true);
      setValue(outcomeRow, '未结束', true);
      return;
    }
    const { array = [], variables = {}, event, done, result, target } = step;
    const { left, right, mid } = variables;

    setValue(arrayRow, array.length === 0 ? '空数组 []' : `[${array.join(', ')}] · ${array.length} 个`);

    const rangeValid = left <= right && left >= 0 && right < array.length;
    setValue(leftRow, rangeValid ? String(left) : `${left}（已越界）`, !rangeValid);
    setValue(rightRow, rangeValid ? String(right) : `${right}（已越界）`, !rangeValid);
    setValue(midRow, mid === null || mid === undefined ? '未计算' : `${mid}（A[mid]=${array[mid]}）`, mid === null || mid === undefined);

    if (array.length === 0) setValue(rangeRow, '空数组：不访问任何元素', true);
    else if (!rangeValid) setValue(rangeRow, `空区间（left=${left} > right=${right}）`, true);
    else setValue(rangeRow, `${left}～${right}`);

    const excluded = array.map((_, i) => i).filter((i) => i < left || i > right);
    setValue(excludedRow, array.length === 0 ? '无' : excluded.length === 0 ? '无' : `${excluded.join('、')}（${excluded.length} 个）`, excluded.length === 0);

    setValue(eventRow, `${step.stepIndex + 1}. ${EVENT_TEXT[event] ?? event}`);
    setValue(outcomeRow, done ? (result >= 0 ? `找到目标 ${target}，下标 ${result}` : `未找到目标 ${target}`) : '未结束', !done);
  }

  const groups = [arrayGroup, ptrGroup, rangeGroup, resultGroup];
  update(run?.steps?.[0] ?? null);

  return {
    update,
    getGroups: () => groups.map((g) => g.items),
    destroy: () => { root.remove(); }
  };
}
