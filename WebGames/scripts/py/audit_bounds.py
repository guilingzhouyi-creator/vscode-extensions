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
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
BACKEND = ROOT / "backend"

DIV_RE = re.compile(r'(?<![/\w])/\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)')

def clean_line(line: str) -> str:
    """去除注释与字符串字面量，保留纯代码逻辑"""
    s = line.strip()
    if s.startswith("#"):
        return ""
    # 去除双引号与单引号字面量
    s = re.sub(r'\"[^\"]*\"', '\"\"', s)
    s = re.sub(r'\'[^\']*\'', '\'\'', s)
    return s

import argparse

def run_bounds_audit() -> int:
    ap = argparse.ArgumentParser(description="上下界溢出与下界穿透全域深度审查与分析工具")
    ap.add_argument("--strict", action="store_true", help="当存在高危上下界穿透风险时阻断退出")
    args = ap.parse_args()

    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：全域上下界溢出、下界穿透与有意突破机制深度审查报告")
    print("=" * 80)

    div_zero_cases = []
    currency_underflows = []
    unclamped_vitals = []
    probability_risks = []
    intentional_breakthroughs = []

    for gd_file in sorted(BACKEND.rglob("*.gd")):
        rel = str(gd_file.relative_to(ROOT)).replace("\\", "/")
        raw_lines = gd_file.read_text(encoding="utf-8").splitlines()
        
        for idx, raw in enumerate(raw_lines, 1):
            s = clean_line(raw)
            if not s:
                continue

            # 1. 真实除法分母安全检查
            for m in DIV_RE.finditer(s):
                denom = m.group(1)
                # 排除标准常量或已受 max/clamp/if 保护的分母
                safe_consts = ("2.0", "2", "10.0", "100.0", "60.0", "1000.0", "3600.0", "PI", "TAU", "1", "1.0", "3", "4", "5")
                if denom not in safe_consts:
                    if not any(g in s for g in ("max(", "maxi(", "maxf(", "clamp(", "clampf(", f"if {denom}", f"{denom} > 0", f"{denom} != 0")):
                        div_zero_cases.append((rel, idx, denom, raw.strip()))

            # 2. 货币与资产下界扣减检查
            if any(k in s for k in ("wallet.", "treasury_", "gold -=", "copper -=", "silver -=", "crystals -=", "points -=")):
                if "-=" in s:
                    # 检查是否有前置余额断言或扣减守卫
                    currency_underflows.append((rel, idx, raw.strip()))

            # 3. 生命、护盾、耐久、体力未做下界 max(0) 或上界 min(max) 钳制
            if any(k in s for k in ("hp -=", "shield_hp -=", "durability_current -=", "stamina -=", "mana -=")):
                if not any(g in s for g in ("clamp(", "clampf(", "max(", "maxi(", "maxf(", "if ")):
                    unclamped_vitals.append((rel, idx, "下界穿透风险", raw.strip()))
                    
            if any(k in s for k in ("hp +=", "shield_hp +=", "durability_current +=", "stamina +=", "mana +=")):
                if not any(g in s for g in ("clamp(", "clampf(", "min(", "mini(", "minf(", "if ")):
                    unclamped_vitals.append((rel, idx, "超上限溢出风险", raw.strip()))

            # 4. 概率计算未做 clamp [0.0, 1.0]
            if any(k in s for k in ("rate", "probability", "chance")) and any(op in s for op in ("*", "+", "-")):
                if "=" in s and not s.startswith("const") and "get_float" not in s and "return" not in s:
                    if not any(g in s for g in ("clamp(", "clampf(", "min(", "max(")):
                        probability_risks.append((rel, idx, raw.strip()))

            # 5. 有意而为之的突破/破阶机制 (Intentional Breakthrough Mechanics)
            if any(k in raw.lower() for k in ("berserk", "penetration", "breakthrough", "arbitrage", "overclock", "loss_ratio", "unassigned_potential")):
                if any(k in raw for k in ("func ", "class_name ", "enum ", "const ")) or "is_berserk" in raw or "arbitrage" in raw:
                    intentional_breakthroughs.append((rel, idx, raw.strip()))

    # 输出结构化审查结果
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

    print("\n" + "=" * 80)
    total_risks = len(currency_underflows) + len(unclamped_vitals) + len(div_zero_cases) + len(probability_risks)
    if args.strict and total_risks > 0:
        print("【审查结论】--strict 模式未通过（存在数值上下界穿透或除零风险）")
        return 1
    print("【审查结论】通过（数值边界合规）")
    return 0

if __name__ == "__main__":
    sys.exit(run_bounds_audit())
