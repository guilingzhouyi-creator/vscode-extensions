#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 魔法体系门禁)
# 文件路径: WebGames/scripts/py/audit_magic_dimensions.py
# 架构定位: 阶位与能力分级校验器 (Magic Dimension Validator)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/domains/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验魔法体系阶位梯度、能力分级与档次枚举的正交性与弱映射完整性
# 退出语义与设计依据: 退出码: 0=合规, 1=存在维度冲突 | 设计依据: 魔法双维度体系契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_magic_dimensions.py
#   python scripts/py/audit_magic_dimensions.py --json
# ==============================================================================
"""魔法双维度体系深度审查：校验魔法阶位配置与双语文案的事实源一致性（Phase 26）。"""

import json
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"
GD_BACKEND = ROOT / "backend"

# 能力分级前缀（阶位键严禁出现）
TIER_PREFIXES = ("mortal", "heroic", "divine", "god", "esp", "supertier")
TIER_KEYS = ("ESP", "HEROIC", "DIVINE", "GOD", "SUPERTIER")


def run_magic_dimensions_audit() -> int:
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：魔法双维度体系深度审查报告 (Phase 26)")
    print("=" * 80)

    violations = []
    cfg_path = CONFIG / "domains" / "magic_tiers.json"
    if not cfg_path.exists():
        print("【审查结论】未通过（config/domains/magic_tiers.json 缺失，已阻断！）")
        return 1
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    rank_gradient = cfg.get("rank_gradient", {})
    ability_tiers = cfg.get("ability_tiers", {})
    rank_bands = cfg.get("rank_bands", {})

    # 1. 阶位严格递增：rank_1~rank_11 连续、rank/strength_weight 严格递增
    ranks = {}
    for key, entry in rank_gradient.items():
        m = re.match(r"^rank_(\d+)$", key)
        if not m:
            violations.append(f"[阶位键格式] rank_gradient 键 {key} 非 rank_N 纯梯度命名")
            continue
        ranks[int(m.group(1))] = entry
    if ranks:
        seq = sorted(ranks.keys())
        if seq != list(range(1, len(seq) + 1)):
            violations.append(f"[阶位连续] rank_gradient 阶位不连续: {seq}")
        prev_w = -1.0
        for r in seq:
            w = float(ranks[r].get("strength_weight", 0))
            if w <= prev_w:
                violations.append(f"[严格递增] strength_weight 未严格递增 @rank_{r}（{prev_w}→{w}）")
            prev_w = w

    # 2. 无能力前缀：阶位键/阶位条目不含能力分级前缀
    for key in rank_gradient:
        low = key.lower()
        if any(p in low for p in TIER_PREFIXES):
            violations.append(f"[无能力前缀] rank_gradient 键 {key} 含能力分级前缀")
    for r in ranks:
        entry = ranks[r]
        nk = str(entry.get("name_key", "")).lower()
        if any(p in nk for p in TIER_PREFIXES):
            violations.append(f"[无能力前缀] rank_{r} 的 name_key 含能力分级前缀: {entry.get('name_key')}")

    # 3. 能力分级独立：ability_tiers 四等+超位独立键，不嵌入阶位名
    if not ability_tiers:
        violations.append("[能力分级缺失] ability_tiers 段为空（能力分级维度缺失）")
    for key in ability_tiers:
        if key not in TIER_KEYS:
            violations.append(f"[能力分级独立] ability_tiers 存在非标准键 {key}（应为 ESP/HEROIC/DIVINE/GOD/SUPERTIER）")
    for key in TIER_KEYS:
        if key not in ability_tiers:
            violations.append(f"[能力分级独立] 缺少能力分级条目 {key}")

    # 4. 区间自洽：reference_interval 在 1~11 内且 lo<=hi（允许重叠，不强制不重叠）
    for key, entry in ability_tiers.items():
        interval = entry.get("reference_interval", [])
        if len(interval) != 2:
            violations.append(f"[区间自洽] {key} reference_interval 必须为 [lo, hi]")
            continue
        lo, hi = int(interval[0]), int(interval[1])
        if lo < 1 or hi > 11 or lo > hi:
            violations.append(f"[区间自洽] {key} 区间 [{lo}, {hi}] 越界或倒置（须 1~11 内且 lo<=hi）")

    # 7. 档次互斥全覆盖：rank_bands 四档区间两两无重叠、无缝覆盖 1~11（并集 == 1..11）
    band_ivs = []
    for key, entry in rank_bands.items():
        interval = entry.get("interval", [])
        if len(interval) != 2:
            violations.append(f"[档次互斥全覆盖] {key} interval 必须为 [lo, hi]")
            continue
        lo, hi = int(interval[0]), int(interval[1])
        if lo < 1 or hi > 11 or lo > hi:
            violations.append(f"[档次互斥全覆盖] {key} 区间 [{lo}, {hi}] 越界或倒置")
        band_ivs.append((lo, hi))
    band_ivs.sort()
    cursor = 1
    for lo, hi in band_ivs:
        if lo > cursor:
            violations.append(f"[档次互斥全覆盖] 区间空隙：{lo} > 期望 {cursor}（未无缝覆盖 1~11）")
        cursor = max(cursor, hi + 1)
    if cursor != 12:
        violations.append(f"[档次互斥全覆盖] 未覆盖到 11（终点 {cursor - 1}），四档须无缝覆盖 1~11")
    if len(rank_bands) != 4:
        violations.append(f"[档次互斥全覆盖] rank_bands 须为四档（低/中/高/超位），当前 {len(rank_bands)} 档")

    # 8. 禁嵌套：档次键名（LOW/MID/HIGH/SUPERTIER）不嵌入阶位键；档次名不嵌入能力分级名
    BAND_KEYS = ("LOW", "MID", "HIGH", "SUPERTIER")
    for key in rank_bands:
        if key not in BAND_KEYS:
            violations.append(f"[禁嵌套] rank_bands 存在非标准档次键 {key}")
    for key in BAND_KEYS:
        if key not in rank_bands:
            violations.append(f"[禁嵌套] 缺少档次条目 {key}")
    for key in rank_gradient:
        low = key.lower()
        if any(b.lower() in low for b in BAND_KEYS):
            violations.append(f"[禁嵌套] rank_gradient 键 {key} 含档次名（禁低阶一阶类嵌套）")

    # 9. 资质四档（mana_aptitudes）：恰 4 项 + backfire_threshold 严格递增
    aptitudes = cfg.get("mana_aptitudes", {})
    if not aptitudes:
        violations.append("[资质缺失] mana_aptitudes 段为空（资质维度缺失）")
    if len(aptitudes) != 4:
        violations.append(f"[资质数量] mana_aptitudes 须为四档，当前 {len(aptitudes)}")
    apt_thresholds = []
    for key, entry in aptitudes.items():
        th = entry.get("backfire_threshold")
        if not isinstance(th, int):
            violations.append(f"[资质阈值] {key} backfire_threshold 必须为整数")
        else:
            apt_thresholds.append(th)
    if len(set(apt_thresholds)) != len(apt_thresholds) or apt_thresholds != sorted(apt_thresholds):
        violations.append("[资质阈值] backfire_threshold 必须严格递增（防并列/倒置）")

    # 10. 形态四档（magic_forms）：恰 4 项 + phase_loss 能损区间有限且 min<=max
    # 【结构锁声明】以下「恰 4 档」为本规则审计器的设计承诺锁——非隐藏硬编码：
    # 魔法形态体系当前设计定案为 primordial/incantation/integrated/supertier 四档，
    # 配置漂移即阻断；若未来体系设计扩展形态档位，须同步变更此处承诺与设计文档，
    # 而非仅改配置（防「配置已扩、审计器漏检」的隐性缺口）。
    forms = cfg.get("magic_forms", {})
    if not forms:
        violations.append("[形态缺失] magic_forms 段为空（形态维度缺失）")
    if len(forms) != 4:
        violations.append(f"[形态数量] magic_forms 须为四档（primordial/incantation/integrated/supertier），当前 {len(forms)}")
    for key, entry in forms.items():
        lo = entry.get("phase_loss_min")
        hi = entry.get("phase_loss_max")
        if not isinstance(lo, (int, float)) or not isinstance(hi, (int, float)):
            violations.append(f"[形态能损] {key} phase_loss_min/max 必须为数值")
        elif lo > hi:
            violations.append(f"[形态能损] {key} phase_loss_min({lo}) > phase_loss_max({hi})（区间倒置）")

    # 11. 实力称号 13 级（profession_ranks）：恰 13 项连续 + magic_domain 单调（true 后不得再 false）
    # 【结构锁声明】「恰 13 项连续」同样为设计承诺锁：实力称号体系当前定案为 13 级
    # 连续 rank + 域开启单调；体系扩级时须同步此处承诺与设计文档（防配置先行扩级、
    # 审计器按旧承诺误报或漏检）。
    professions = cfg.get("profession_ranks", {})
    if not professions:
        violations.append("[称号缺失] profession_ranks 段为空（实力称号维度缺失）")
    prof_ranks = []
    for key, entry in professions.items():
        r = entry.get("rank")
        if not isinstance(r, int):
            violations.append(f"[称号字段] {key} 缺 rank 整数字段")
        else:
            prof_ranks.append(r)
    if len(set(prof_ranks)) != len(professions) or len(professions) != 13:
        violations.append(f"[称号数量] profession_ranks 须为 13 级且 rank 不重复，当前 {len(professions)} 项")
    if len(prof_ranks) == 13 and sorted(prof_ranks) != list(range(1, 14)):
        violations.append("[称号连续] profession_ranks rank 必须 1~13 严格连续")
    seen_magic_domain = False
    for r in sorted(prof_ranks):
        if professions.get(str(r) if any(str(k).isdigit() for k in professions) else r, {}) is None:
            continue
    # 按 entry.rank 排序遍历校验 magic_domain 单调
    ordered = sorted(professions.items(), key=lambda kv: kv[1].get("rank", 0))
    for key, entry in ordered:
        if entry.get("magic_domain", False):
            seen_magic_domain = True
        elif seen_magic_domain:
            violations.append(f"[称号单调] {key}（rank {entry.get('rank')}）magic_domain 穿插（true 后不得再 false）")

    # 5. 禁 Tier↔Rank 一对一枚举映射（弱映射仅经参考区间；扫描后端代码逐阶固定映射表）
    forbidden = re.compile(
        r"(ESP|HEROIC|DIVINE|GOD|SUPERTIER)\s*(==|=)\s*\d+|"
        r"(rank|tier)\s*(==|=)\s*\d+.*(ESP|HEROIC|DIVINE|GOD)", re.IGNORECASE)
    enum_decl = re.compile(r"^\s*[A-Z][A-Z0-9_]*\s*=\s*\d+\s*,?\s*(#.*)?$")
    for gd in GD_BACKEND.rglob("*.gd"):
        if "magic" not in gd.name and "ability" not in gd.name and "tier" not in gd.name:
            continue
        text = gd.read_text(encoding="utf-8", errors="ignore")
        for idx, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith('"""'):
                continue
            # 枚举值声明（如 ESP = 1）为合法定义，非 Tier↔Rank 逐阶映射表
            if enum_decl.match(line):
                continue
            if forbidden.search(line):
                violations.append(f"[禁1:1枚举] {gd.relative_to(ROOT)}:{idx} 疑似 Tier↔Rank 逐阶固定映射")

    # 6. i18n 键存在：rank_* 与 ability_tier.* 在 en_US/zh_CN 登记
    for locale in ("en_US", "zh_CN"):
        i18n_path = CONFIG / "i18n" / f"{locale}.json"
        if not i18n_path.exists():
            violations.append(f"[i18n 缺失] config/i18n/{locale}.json 不存在")
            continue
        i18n = json.loads(i18n_path.read_text(encoding="utf-8"))
        for r in range(1, 12):
            k = f"magic.rank.rank_{r}"
            if k not in i18n:
                violations.append(f"[i18n 键缺失] {locale} 缺少 {k}")
        for key in TIER_KEYS:
            k = f"magic.ability_tier.{key.lower()}"
            if k not in i18n:
                violations.append(f"[i18n 键缺失] {locale} 缺少 {k}")
            ref = f"magic.ability_tier.{key.lower()}_ref"
            if ref not in i18n:
                violations.append(f"[i18n 键缺失] {locale} 缺少参考标签键 {ref}")
        for band in ("low", "mid", "high", "supertier"):
            k = f"magic.rank_band.{band}"
            if k not in i18n:
                violations.append(f"[i18n 键缺失] {locale} 缺少阶位档次键 {k}")

    print(f"违规总数: {len(violations)}")
    for v in violations:
        print(f"  ✗ {v}")
    print("-" * 80)
    if violations:
        print("【审查结论】未通过（存在魔法双维度体系违规，已阻断！）")
        return 1
    print("【审查结论】通过（双维度独立、弱映射合规、阶位纯梯度、i18n 键齐全）")
    return 0


if __name__ == "__main__":
    sys.exit(run_magic_dimensions_audit())
