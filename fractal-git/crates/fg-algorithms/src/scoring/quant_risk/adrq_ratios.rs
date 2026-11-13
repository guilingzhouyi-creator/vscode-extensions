//! Module: fg-algorithms — ADR-Q Return, Volatility & Tail Drawdown Ratios
//! File Path: crates/fg-algorithms/src/scoring/quant_risk/adrq_ratios.rs
//! Architecture Role: Evaluates Refactoring Coverage Ratio (`rcr`), Sharpe/Sortino quality
//!   ratios (`erq`, `ddr`), parametric VaR 95% (`edb95`), and peak-to-trough drawdown (`ptd`).
//! Dependencies & Triggers: Consumed by `quant_risk::adrq_stats`.
//! Responsibilities: Compute time-series quality stability indicators parity-matched with TS model.
//! Exit Semantics & Design Rationale: Bounded sliding window caps complexity at linear cost.

const RATIO_SATURATION_CEILING: f64 = 100.0;
const EPSILON_FLOAT: f64 = 1e-6;
const MIN_RISK_DEV_EPSILON: f64 = 0.01;
const MIN_RISK_SAMPLE_SIZE: usize = 3;
const MAX_RISK_WINDOW_SIZE: usize = 500;
const GAUSSIAN_Z_95: f64 = 1.64485;
const PERCENT_SCALE: f64 = 100.0;

fn round_two(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub(crate) fn compute_rcr(
    file_debts: &[f64],
    yield_min: Option<f64>,
    accrual_min: Option<f64>,
) -> f64 {
    if yield_min.is_none() && accrual_min.is_none() {
        return 0.0;
    }
    let debt_sum: f64 = file_debts
        .iter()
        .copied()
        .filter(|d| d.is_finite() && *d > 0.0)
        .sum();
    let drag_minutes = debt_sum * 0.08;
    let safe_yield = yield_min.unwrap_or(0.0).max(0.0);
    let safe_accrual = accrual_min.unwrap_or(0.0).max(0.0);
    let raw = if safe_accrual > 0.0 {
        safe_yield / (safe_accrual + EPSILON_FLOAT)
    } else if safe_yield > 0.0 {
        safe_yield / drag_minutes.max(1.0)
    } else {
        1.0
    };
    round_two(raw.min(RATIO_SATURATION_CEILING))
}

fn scale_excess_ratio(excess: f64, deviation: f64) -> f64 {
    if deviation < EPSILON_FLOAT {
        if excess > 0.0 {
            round_two(excess / MIN_RISK_DEV_EPSILON)
        } else {
            0.0
        }
    } else {
        round_two((excess / deviation).clamp(0.0, RATIO_SATURATION_CEILING))
    }
}

pub(crate) fn compute_risk_ratios(history_scores: &[f64]) -> (f64, f64, f64, f64) {
    if history_scores.len() < MIN_RISK_SAMPLE_SIZE {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let window_start = history_scores
        .len()
        .saturating_sub(MAX_RISK_WINDOW_SIZE.min(50));
    let samples = &history_scores[window_start..];
    let (mut sum, mut finite_count) = (0.0_f64, 0usize);
    for &val in samples {
        if val.is_finite() {
            sum += val;
            finite_count += 1;
        }
    }
    if finite_count < MIN_RISK_SAMPLE_SIZE {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let baseline = compute_fifth_percentile_baseline(samples);
    let mean = sum / (finite_count as f64);
    let (mut sum_var, mut sum_down) = (0.0_f64, 0.0_f64);
    for &score in samples {
        if score.is_finite() {
            let diff = score - mean;
            sum_var += diff * diff;
            let down = (score - baseline).min(0.0);
            sum_down += down * down;
        }
    }
    let std_dev = (sum_var / ((finite_count - 1) as f64)).sqrt();
    let downside_dev = (sum_down / (finite_count as f64)).sqrt();
    let excess = mean - baseline;
    let (edb95, ptd) = compute_var95_and_mdd(samples);
    (
        scale_excess_ratio(excess, std_dev),
        scale_excess_ratio(excess, downside_dev),
        edb95,
        ptd,
    )
}

fn compute_fifth_percentile_baseline(samples: &[f64]) -> f64 {
    let mut sorted: Vec<f64> = samples.iter().copied().filter(|v| v.is_finite()).collect();
    if sorted.is_empty() {
        return 0.0;
    }
    sorted.sort_by(f64::total_cmp);
    if sorted.len() < MIN_RISK_SAMPLE_SIZE {
        let total: f64 = sorted.iter().copied().sum();
        return round_two(total / (sorted.len() as f64));
    }
    let rank = 0.05 * ((sorted.len() - 1) as f64);
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;
    let weight = rank - (lower as f64);
    round_two(sorted[lower] + weight * (sorted[upper] - sorted[lower]))
}

fn compute_var95_and_mdd(samples: &[f64]) -> (f64, f64) {
    if samples.len() < 2 {
        return (0.0, 0.0);
    }
    let (mut peak, mut max_dd) = (samples[0], 0.0_f64);
    let (mut delta_sum, mut delta_count) = (0.0_f64, 0usize);
    for idx in 1..samples.len() {
        let (cur, prev) = (samples[idx], samples[idx - 1]);
        if !cur.is_finite() || !prev.is_finite() {
            continue;
        }
        delta_sum += cur - prev;
        delta_count += 1;
        if cur > peak {
            peak = cur;
        }
        if peak > 0.0 {
            max_dd = max_dd.max(((peak - cur) / peak) * PERCENT_SCALE);
        }
    }
    if delta_count < 2 {
        return (0.0, round_two(max_dd));
    }
    let delta_mean = delta_sum / (delta_count as f64);
    let mut var_sum = 0.0_f64;
    for idx in 1..samples.len() {
        let (cur, prev) = (samples[idx], samples[idx - 1]);
        if cur.is_finite() && prev.is_finite() {
            let diff = (cur - prev) - delta_mean;
            var_sum += diff * diff;
        }
    }
    let delta_std = (var_sum / ((delta_count - 1) as f64)).sqrt();
    let var95 = round_two(-(delta_mean - GAUSSIAN_Z_95 * delta_std)).max(0.0);
    (var95, round_two(max_dd))
}
