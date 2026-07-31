import { useEffect, useState } from 'react';

/**
 * 数字滚动动画 hook：从 0 平滑过渡到目标值。
 *
 * @param {number} target 目标数值
 * @param {number} [duration=800] 动画时长（毫秒）
 * @param {*} [resetKey=target] 重置动画的依赖；变化时重新从 0 滚动，不变则保持终值，避免轮询抖动
 * @returns {number} 当前动画值
 */
export function useAnimatedNumber(target, duration = 800, resetKey = target) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setValue(target);
      return undefined;
    }

    const from = 0;
    const diff = target;
    const startedAt = performance.now();
    let frame = 0;

    setValue(0);

    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + diff * eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [duration, resetKey, target]);

  return value;
}
