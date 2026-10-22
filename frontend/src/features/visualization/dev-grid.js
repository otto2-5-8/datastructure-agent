/**
 * 成员03 开发自测页的【视口网格透明度映射】（dev-only）
 *
 * 背景有两层网格：细格（16px）与粗格（80px）。它们的透明度随视口缩放交叉变化，
 * 避免缩放到某个倍率时格子太密糊成一片、或者太稀看着空。
 *
 * 方向（按用户 2026-10-15 指定）：
 *   zoom 大（贴近）  → 细格更淡、粗格更实
 *   zoom 小（拉远）  → 细格更实、粗格更淡
 *
 * 说明：Blender 世界网格的实际算法是相反的——它是"世界空间网格 + 屏幕密度衰减"，
 * zoom 大时细格反而淡【入】（因为细格在屏幕上变稀了）。这里的两层网格是**屏幕固定间距**
 * （不随缩放改变间距），所以"贴近时让细格退让、粗格主导"是自洽的做法。
 * 若要改成 Blender 那种方向，把下面 FINE_RANGE / COARSE_RANGE 两组数对调即可。
 */

/** 细/粗网格的基础线色透明度（写在 CSS 的 rgba 里），这里只输出 0～1 的调制系数。 */
export const GRID_CONFIG = {
  fineSizePx: 16,
  coarseSizePx: 80,
  // 缩放的映射区间（对数刻度，视觉上更均匀）：小于 zoomOut 全是"拉远端"，大于 zoomIn 全是"贴近端"
  zoomOut: 0.6,
  zoomIn: 2.5,
  // [拉远端系数, 贴近端系数]
  fineRange: [1.0, 0.25],
  coarseRange: [0.3, 1.0]
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * 按缩放值算出两层网格的透明度系数。
 * @param {number} scale 视口缩放（1 = 原始大小）
 * @returns {{fine: number, coarse: number, t: number}} 0～1 的系数；t 是归一化后的"贴近度"
 */
export function gridOpacityFor(scale) {
  const { zoomOut, zoomIn, fineRange, coarseRange } = GRID_CONFIG;
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // 用对数刻度：0.3~3 这种跨一个数量级的缩放，线性刻度会把大部分变化挤在偏大的一端
  const t = clamp01(
    (Math.log(safe) - Math.log(zoomOut)) / (Math.log(zoomIn) - Math.log(zoomOut))
  );
  return {
    t,
    fine: clamp01(lerp(fineRange[0], fineRange[1], t)),
    coarse: clamp01(lerp(coarseRange[0], coarseRange[1], t))
  };
}

/**
 * 把系数写到两层网格元素上。
 * @param {{fine?: HTMLElement, coarse?: HTMLElement}} layers
 * @param {number} scale
 */
export function applyGridOpacity(layers, scale) {
  const { fine, coarse } = gridOpacityFor(scale);
  if (layers?.fine?.style) layers.fine.style.opacity = String(fine);
  if (layers?.coarse?.style) layers.coarse.style.opacity = String(coarse);
  return { fine, coarse };
}
