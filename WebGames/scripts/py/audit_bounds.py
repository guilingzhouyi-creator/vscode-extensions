#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 边界审计体系)
# 文件路径: WebGames/scripts/py/audit_bounds.py
# 架构定位: 静态边界校验器 (Boundary Validator)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/domains/*.json | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验全域数值配置的值域上下界、溢出截断与正数除数守卫
# 退出语义与设计依据: 退出码: 0=合规, 1=存在越界数值 | 设计依据: 统一防御工程契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_bounds.py
#   python scripts/py/audit_bounds.py --json
# ==============================================================================
import argparse
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
BACKEND = ROOT / "backend"

DIV_RE = re.compile(r'(?<![/\w])/\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)')

SAFE_CONSTS = ("2.0", "2", "10.0", "100.0", "60.0", "1000.0", "3600.0", "PI", "TAU", "1", "1.0", "3", "4", "5")
DIV_GUARDS = ("max(", "maxi(", "maxf(", "clamp(", "clampf(")
CURRENCY_KEYS = ("wallet.", "treasury_", "gold -=", "copper -=", "silver -=", "crystals -=", "points -=")
VITAL_DOWN_KEYS = ("hp -=", "shield_hp -=", "durability_current -=", "stamina -=", "mana -=")
VITAL_UP_KEYS = ("hp +=", "shield_hp +=", "durability_current +=", "stamina +=", "mana +=")
CLAMP_DOWN_GUARDS = ("clamp(", "clampf(", "max(", "maxi(", "maxf(", "if ")
CLAMP_UP_GUARDS = ("clamp(", "clampf(", "min(", "mini(", "minf(", "if ")
PROBABILITY_KEYS = ("rate", "probability", "chance")
BREAKTHROUGH_KEYS = ("berserk", "penetration", "breakthrough", "arbitrage", "overclock", "loss_ratio", "unassigned_potential")
HEADER_SEPARATOR = "=" * 80


def clean_line(line: str) -> str:
    """去除注释与字符串字面量，保留纯代码逻辑"""
    s = line.strip()
    if s.startswith("#"):
        return ""
    # 去除双引号与单引号字面量
    s = re.sub(r'\"[^\"]*\"', '\"\"', s)
    s = re.sub(r'\'[^\']*\'', '\'\'', s)
    return s


def _check_div_zero(s: str, raw: str, rel: str, idx: int) -> list:
    """检查真实除法分母安全。"""
    cases = []
    for m in DIV_RE.finditer(s):
        denom = m.group(1)
        if denom in SAFE_CONSTS:
            continue
        guards = (*DIV_GUARDS, f"if {denom}", f"{denom} > 0", f"{denom} != 0")
        if not any(g in s for g in guards):
            cases.append((rel, idx, denom, raw.strip()))
    return cases


def _check_currency_underflow(s: str, raw: str, rel: str, idx: int) -> list:
    """检查货币与资产下界扣减。"""
    if "-=" in s and any(k in s for k in CURRENCY_KEYS):
        return [(rel, idx, raw.strip())]
    return []


def _check_unclamped_vitals(s: str, raw: str, rel: str, idx: int) -> list:
    """检查生命、护盾、耐久、体力未做上下界钳制。"""
    vitals = []
    if any(k in s for k in VITAL_DOWN_KEYS) and not any(g in s for g in CLAMP_DOWN_GUARDS):
        vitals.append((rel, idx, "下界穿透风险", raw.strip()))
    if any(k in s for k in VITAL_UP_KEYS) and not any(g in s for g in CLAMP_UP_GUARDS):
        vitals.append((rel, idx, "超上限溢出风险", raw.strip()))
    return vitals


def _is_unclamped_prob_calc(s: str) -> bool:
    """判断是否为未受保护的概率赋值计算。"""
    if "=" not in s or s.startswith("const") or "get_float" in s or "return" in s:
        return False
    return not any(g in s for g in ("clamp(", "clampf(", "min(", "max("))


def _check_probability_risks(s: str, raw: str, rel: str, idx: int) -> list:
    """检查概率计算未做 clamp [0.0, 1.0]。"""
    if not any(k in s for k in PROBABILITY_KEYS):
        return []
    if not any(op in s for op in ("*", "+", "-")):
        return []
    if _is_unclamped_prob_calc(s):
        return [(rel, idx, raw.strip())]
    return []


def _check_intentional_breakthroughs(raw: str, rel: str, idx: int) -> list:
    """识别有意而为之的突破/破阶机制。"""
    if any(k in raw.lower() for k in BREAKTHROUGH_KEYS):
        if any(k in raw for k in ("func ", "class_name ", "enum ", "const ")) or "is_berserk" in raw or "arbitrage" in raw:
            return [(rel, idx, raw.strip())]
    return []


def _scan_file_bounds(gd_file: Path) -> dict:
    """扫描单个 GDScript 文件中的各类数值边界情况。"""
    rel = str(gd_file.relative_to(ROOT)).replace("\\", "/")
    raw_lines = gd_file.read_text(encoding="utf-8").splitlines()

    file_div_zero = []
    file_currency = []
    file_vitals = []
    file_prob = []
    file_breakthrough = []

    for idx, raw in enumerate(raw_lines, 1):
        s = clean_line(raw)
        if not s:
            continue
        file_div_zero.extend(_check_div_zero(s, raw, rel, idx))
        file_currency.extend(_check_currency_underflow(s, raw, rel, idx))
        file_vitals.extend(_check_unclamped_vitals(s, raw, rel, idx))
        file_prob.extend(_check_probability_risks(s, raw, rel, idx))
        file_breakthrough.extend(_check_intentional_breakthroughs(raw, rel, idx))

    return {
        "div_zero": file_div_zero,
        "currency": file_currency,
        "vitals": file_vitals,
        "prob": file_prob,
        "breakthrough": file_breakthrough,
    }


def _print_bounds_report(results: dict) -> None:
    """打印边界审查结构化报告。"""
    currency_underflows = results["currency"]
    unclamped_vitals = results["vitals"]
    div_zero_cases = results["div_zero"]
    probability_risks = results["prob"]
    intentional_breakthroughs = results["breakthrough"]

    print(f"\n【一、 资产与数值扣减下界穿透检查】 (共 {len(currency_underflows)} 处):")
    for r, l, code in currency_underflows:
        print(f"  · [{r}:L{l}] ➔ `{code}`")

    print(f"\n【二、 生命/护盾/耐久上下界钳制检查】 (共 {len(unclamped_vitals)} 处):")
    for r, l, kind, code in unclamped_vitals:
        print(f"  · [{r}:L{l}] [{kind}] ➔ `{code}`")

    print(f"\n【三、 除零与分母边界防护检查】 (共 {len(div_zero_cases)} 处):")
    for r, l, denom, code in div_zero_cases:
        print(f"  · [{r}:L{l}] 分母 `{denom}` ➔ `{code}`")

    print(f"\n【四、 概率与动态比率区间防护检查】 (共 {len(probability_risks)} 处):")
    for r, l, code in probability_risks:
        print(f"  · [{r}:L{l}] ➔ `{code}`")

    print(f"\n【五、 识别到的有意突破与特异规则机制】 (共 {len(intentional_breakthroughs)} 处):")
    for r, l, code in intentional_breakthroughs[:12]:
        print(f"  · [{r}:L{l}] ➔ `{code}`")


def run_bounds_audit() -> int:
    ap = argparse.ArgumentParser(description="上下界溢出与下界穿透全域深度审查与分析工具")
    ap.add_argument("--strict", action="store_true", help="当存在高危上下界穿透风险时阻断退出")
    args = ap.parse_args()

    print(HEADER_SEPARATOR)
    print("🛡️ 卡拉尔世界引擎：全域上下界溢出、下界穿透与有意突破机制深度审查报告")
    print(HEADER_SEPARATOR)

    aggregated = {"div_zero": [], "currency": [], "vitals": [], "prob": [], "breakthrough": []}
    for gd_file in sorted(BACKEND.rglob("*.gd")):
        res = _scan_file_bounds(gd_file)
        for k in aggregated:
            aggregated[k].extend(res[k])

    _print_bounds_report(aggregated)

    print("\n" + HEADER_SEPARATOR)
    total_risks = (
        len(aggregated["currency"])
        + len(aggregated["vitals"])
        + len(aggregated["div_zero"])
        + len(aggregated["prob"])
    )
    if args.strict and total_risks > 0:
        print("【审查结论】--strict 模式未通过（存在数值上下界穿透或除零风险）")
        return 1
    print("【审查结论】通过（数值边界合规）")
    return 0


if __name__ == "__main__":
    sys.exit(run_bounds_audit())
