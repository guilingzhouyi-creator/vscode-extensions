/**
 * Universal Spring Physics & Damped Harmonic Oscillator Presets
 * 
 * 经典二阶阻尼谐振子参数化动力学模型：
 *   m * x'' + c * x' + k * (x - x_target) = 0
 *   阻尼比 ζ = c / (2 * sqrt(m * k))
 */

export interface SpringConfig {
    readonly stiffness: number; // k: 弹性刚度 (N/m)
    readonly damping: number;   // c: 阻尼系数 (N·s/m)
    readonly mass: number;      // m: 物体质量 (kg)
}

/**
 * 求解给定时间 t 下的归一化位移 (0 -> 1)
 *
 * @param config - 弹簧质量与阻尼参数
 * @param t - 距离动画开始经过的时间 (秒)
 * @returns 归一化位移进度 [0.0 ~ 1.0+]
 */
export function solveHarmonicOscillator(config: SpringConfig, t: number): number {
    const { stiffness: k, damping: c, mass: m } = config;
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(m * k));

    if (zeta < 1.0) {
        // 欠阻尼态 (Underdamped): 伴随微冲回弹振荡
        const wd = w0 * Math.sqrt(1.0 - zeta * zeta);
        const decay = Math.exp(-zeta * w0 * t);
        const oscillation = Math.cos(wd * t) + (zeta / Math.sqrt(1.0 - zeta * zeta)) * Math.sin(wd * t);
        return 1.0 - decay * oscillation;
    }

    if (Math.abs(zeta - 1.0) < 1e-4) {
        // 临界阻尼 (Critically damped): 最快无振荡平稳收敛
        return 1.0 - Math.exp(-w0 * t) * (1.0 + w0 * t);
    }

    // 过阻尼态 (Overdamped): 阻力过大单调缓慢吸附
    const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1.0));
    const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1.0));
    return 1.0 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

/**
 * 预设 1: 欠阻尼利落回弹 (Snappy)
 * 适用场景：按钮点击、开关切换、图标触觉微弹。
 * 参数特征：超调量 +8.8% (ζ = 0.612)，约 0.22s 极速收敛。
 */
export const SPRING_SNAPPY: SpringConfig = Object.freeze({
    stiffness: 600,
    damping: 30,
    mass: 1.0,
});

/**
 * 预设 2: 欠阻尼平稳着陆 (Gentle)
 * 适用场景：卡片展开、Popover 浮层弹出、消息上浮。
 * 参数特征：超调量 +1.8% (ζ = 0.783)，约 0.35s 收敛。
 */
export const SPRING_GENTLE: SpringConfig = Object.freeze({
    stiffness: 320,
    damping: 28,
    mass: 1.0,
});

/**
 * 预设 3: 明显弹性跳跃 (Bouncy)
 * 适用场景：点赞成功、复制完成打勾、新消息红点提示。
 * 参数特征：超调量 +19.4% (ζ = 0.462)，约 0.58s 收敛。
 */
export const SPRING_BOUNCY: SpringConfig = Object.freeze({
    stiffness: 380,
    damping: 18,
    mass: 1.0,
});

/**
 * 预设 4: 过阻尼强力磁吸 (HeavySnap)
 * 适用场景：双栏拖拽分界线吸附、抽屉面板松手咬合。
 * 参数特征：绝对 0% 超调 (ζ = 3.650)，约 0.14s 强力磁性咬合。
 */
export const SPRING_HEAVY_SNAP: SpringConfig = Object.freeze({
    stiffness: 1200,
    damping: 80,
    mass: 0.1,
});
