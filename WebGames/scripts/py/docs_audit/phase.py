#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 施工细则与路线图门禁)
# 文件路径: WebGames/scripts/py/docs_audit/phase.py
# 架构定位: 四阶段施工细则与短期施工区治理门禁 (Phase Governance Gate)
# 依赖与触发: 触发方: DocsAuditor.check() | 上游: docs/路线图/ | 下游: Finding 发现项 | 运行时: Python 3.10+
# 职责说明: 短期施工区案卷物理结构、路线图总索引真源登记、时间戳纪律与四段式施工细则深度审查
# 退出语义与设计依据: 退出码: 纯检查函数无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   check_phase_governance(docs_dir, docs_map, rel_fn, out)
# ==============================================================================
"""短期施工区案卷物理结构、路线图总索引真源登记、时间戳纪律与四段式施工细则深度审查。"""
import re
from pathlib import Path
from typing import Any, Callable

from docs_audit.models import Finding


def check_formation_date(docs_dir: Path, rel_fn: Callable, out: list) -> None:
    """开发期施工细则须含「施工开始日期」时间戳（SOP 落戳约定；归档件由 14 项头块承载）。"""
    active_dir = docs_dir / "路线图" / "01_短期施工区"
    if not active_dir.is_dir():
        return
    for phase_dir in sorted(active_dir.glob("Phase_*")):
        for sf in sorted(phase_dir.glob("阶段*_*.md")):
            try:
                head = sf.read_text(encoding="utf-8", errors="ignore")[:1200]
            except OSError:
                continue
            if "# 施工细则" not in head:
                continue
            if not re.search(r"施工开始日期\s*\*{0,2}\s*[:：]", head):
                out.append(Finding(
                    "DATE-STAMP", rel_fn(sf), 1,
                    "开发期施工细则缺少「施工开始日期」时间戳",
                    "请按 SOP 走一步获取系统时间（如 date +%F），在正文题头落「施工开始日期: YYYY-MM-DD」"))


def check_phase_governance(docs_dir: Path, docs_map: dict, rel_fn: Callable, out: list) -> None:
    """短期施工区与路线图全域治理门禁：
    1. 案卷目录物理边界（PHASE-VOLUME-STRUCTURE）：每个案卷内必须且仅允许包含 4 份分阶段施工细则（阶段1~4），严禁自造 README.md、子目录或多余文件；
    2. 制度文档防污染（ROADMAP-README-POLLUTION）：01_短期施工区/README.md 仅作为施工区制度说明规范，严禁向其写入在途案卷或任务列表；
    3. 路线图登记唯一真源（ROADMAP-INDEX-MISSING）：全域在途案卷必须且仅在 docs/路线图/路线图总索引.md 中登记；
    4. 序号连续性与唯一性（NAMING-DIR / NAMING-SEQ）：序号严格递增无跳号无重复。
    """
    active_dir = docs_dir / "路线图" / "01_短期施工区"
    if not active_dir.is_dir():
        return

    # 1. 检查 01_短期施工区/README.md 纯净度
    st_readme = active_dir / "README.md"
    if st_readme.is_file():
        content = st_readme.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"##\s*.*在途案卷", content) or re.search(r"\[Phase_\d+[^\]]*\]\(Phase_\d+", content):
            out.append(Finding(
                "ROADMAP-README-POLLUTION", rel_fn(st_readme), 1,
                "docs/路线图/01_短期施工区/README.md 被污染写入了在途案卷或任务列表！该文件仅作为短期施工区制度说明规范，路线图登记唯一真源为 docs/路线图/路线图总索引.md",
                "请清理 01_短期施工区/README.md 中的在途案卷列表与链接，保持纯净制度说明"
            ))

    # 读取路线图总索引内容
    roadmap_index = docs_dir / "路线图" / "路线图总索引.md"
    roadmap_index_text = roadmap_index.read_text(encoding="utf-8", errors="ignore") if roadmap_index.is_file() else ""

    phase_dirs = [p for p in active_dir.iterdir() if p.is_dir() and p.name.startswith("Phase_")]
    seen_numbers = {}

    for p in phase_dirs:
        m = re.match(r"^Phase_(\d+)_", p.name)
        if not m:
            out.append(Finding(
                "NAMING-DIR", rel_fn(p), 0,
                f"短期施工区目录命名不符合 Phase_NN_前缀规范: {p.name}",
                "请使用 Phase_NN_主题名称 格式"
            ))
            continue
        num = int(m.group(1))
        if num in seen_numbers:
            out.append(Finding(
                "NAMING-DIR", rel_fn(p), 0,
                f"短期施工区存在重复 Phase 序号 [{num}]: 与 {rel_fn(seen_numbers[num])} 冲突",
                "请修正为序列中的下一个合法连续序号"
            ))
        else:
            seen_numbers[num] = p

        # 2. 案卷文件结构铁律检查（严禁自造 README.md、子目录或多余文件）
        sub_entries = list(p.iterdir())
        has_readme = any(f.name.lower() == "readme.md" for f in sub_entries)
        if has_readme:
            out.append(Finding(
                "PHASE-VOLUME-STRUCTURE", rel_fn(p / "README.md"), 1,
                f"案卷目录「{p.name}」存在违规自造 README.md！每个案卷严格仅允许包含 4 份分阶段施工细则（阶段1~4），绝对禁止自造 README.md 或多余汇总文档",
                "请立即删除该 README.md，案卷总览请直接在 docs/路线图/路线图总索引.md 中维护"
            ))

        extra_files = []
        for item in sub_entries:
            if item.is_dir():
                extra_files.append(item.name + "/")
            elif item.is_file():
                if item.name.lower() != "readme.md" and not re.match(r"^阶段[1-4]_.+\.md$", item.name):
                    extra_files.append(item.name)
        if extra_files:
            out.append(Finding(
                "PHASE-VOLUME-STRUCTURE", rel_fn(p), 0,
                f"案卷目录「{p.name}」包含违规多余文件/子目录: {extra_files}！案卷内严格仅允许包含阶段1~4共4份细则文件",
                "请清理案卷内多余文件或子目录"
            ))

        # 3. 四阶段完整性检查与阶段细则深度审查
        stage_files = [f for f in sub_entries if f.is_file() and re.match(r"^阶段[1-4]_.+\.md$", f.name)]
        found_stages = set()
        for sf in stage_files:
            sm = re.match(r"^阶段([1-4])_", sf.name)
            if sm:
                found_stages.add(int(sm.group(1)))
            check_phase_stage_file(sf, docs_map.get(str(sf)), rel_fn, out)
        missing_stages = set([1, 2, 3, 4]) - found_stages
        if missing_stages:
            out.append(Finding(
                "PHASE-VOLUME-STRUCTURE", rel_fn(p), 0,
                f"案卷目录「{p.name}」缺少阶段细则: {missing_stages}（每个案卷必须且仅允许包含阶段1~4共4份文件）",
                "请按四阶段模板补充齐备"
            ))

        # 4. 路线图总索引唯一真源登记检查
        if roadmap_index_text:
            phase_pattern = rf"\bPhase[_\s]{num}\b"
            if not re.search(phase_pattern, roadmap_index_text):
                out.append(Finding(
                    "ROADMAP-INDEX-MISSING", rel_fn(p), 0,
                    f"在途案卷「{p.name}」(Phase {num}) 未在 docs/路线图/路线图总索引.md 中登记！总索引为全域路线图唯一真源",
                    f"请在 docs/路线图/路线图总索引.md 登记「Phase {num}: ...」四阶段细则直达与状态表格"
                ))

    # 5. 检查连续性无跳号
    if seen_numbers:
        nums = sorted(seen_numbers.keys())
        for i in range(len(nums) - 1):
            if nums[i+1] != nums[i] + 1:
                out.append(Finding(
                    "NAMING-SEQ", rel_fn(seen_numbers[nums[i+1]]), 0,
                    f"短期施工区 Phase 序号存在跳号/断号: 从 Phase_{nums[i]:02d} 跳至 Phase_{nums[i+1]:02d}",
                    "短期施工区必须保持严格递增连续且无跳号"
                ))

    # 6. 施工区周期积累过量预警 (ROADMAP-CYCLE-OVERDUE)
    if len(phase_dirs) >= 10:
        out.append(Finding(
            "ROADMAP-CYCLE-OVERDUE", rel_fn(active_dir), 0,
            f"短期施工区在途案卷当前累积已达 {len(phase_dirs)}/10 卷，已达到或超出 10 卷归档周期阈值！",
            "请按归档周期机制执行 python scripts/py/archive_volume.py --cycle --apply 进行周期归档封存，严禁无限制堆积在途案卷"
        ))


def check_phase_stage_file(sf_path: Path, doc: Any, rel_fn: Callable, out: list) -> None:
    """短期施工区阶段施工细则四段式正文深度规范审查：
    1. PHASE-TITLE-FORMAT: 一级标题格式必须为「# 施工细则：<案卷主题> —— 阶段<N>：<阶段主题>」
    2. PHASE-STAGE-STD: 必须包含四段式核心标准结构：
       - 头部 [!NOTE] 目标题头（前 35 行须含【施工目标】）
       - ## 📌 第一性原理溯源指针（含精准上游规范指针、核心不变量约束断言、最高指示）
       - ## 二、 命令式施工执行清单 (Agent Execution Checklist)（含复选框）
       - ## 三、 ...验收矩阵 (DoD Matrix)（含标准表头「检验项 ID」与「预期输出断言」）
    3. PHASE-CODE-SANITY: 代码块不得散落 push_error/push_warning 或 randf/randi
    """
    if not doc:
        return

    lines = doc.lines
    inside = doc.inside
    rel = doc.rel

    # 1. 检查 H1 标题格式
    h1_line_idx = -1
    h1_text = ""
    for i, (ln, ins) in enumerate(zip(lines, inside)):
        if not ins and ln.startswith("# "):
            h1_line_idx = i
            h1_text = ln.strip()
            break

    stage_match = re.match(r"^阶段([1-4])_", sf_path.name)
    expected_stage = stage_match.group(1) if stage_match else ""

    if h1_line_idx == -1:
        out.append(Finding(
            "LAYOUT-H1-ABSENT", rel, 1,
            "阶段细则缺少一级标题"
        ))
    else:
        # 标准格式：# 施工细则：<案卷主题> —— 阶段[1-4]：<阶段主题>
        title_m = re.match(r"^#\s*施工细则[:：].+?(?:——|--)\s*阶段([1-4])[:：].+$", h1_text)
        if not title_m:
            out.append(Finding(
                "PHASE-TITLE-FORMAT", rel, h1_line_idx + 1,
                f"阶段细则 H1 标题「{h1_text}」不符合标准命名格式！",
                "请统一使用标准格式: # 施工细则：<案卷主题> —— 阶段<N>：<阶段主题>"
            ))
        elif expected_stage and title_m.group(1) != expected_stage:
            out.append(Finding(
                "PHASE-TITLE-FORMAT", rel, h1_line_idx + 1,
                f"阶段细则 H1 标题阶段号「阶段{title_m.group(1)}」与文件名「阶段{expected_stage}」不一致！",
                f"请将标题中的阶段号修正为「阶段{expected_stage}」"
            ))

    # 2. 检查头部 [!NOTE] 与目标说明 (前 35 行)
    head_text = "\n".join(lines[:35])
    has_note = bool(re.search(r">\s*\[!NOTE\]", head_text, re.IGNORECASE))
    has_goal = bool(re.search(r"【(?:施工|阶段)目标】|施工目标[:：]", head_text))
    if not (has_note and has_goal):
        out.append(Finding(
            "PHASE-STAGE-STD", rel, 1,
            "阶段细则头部缺少标准 > [!NOTE] 目标题头块（须含【施工目标】）",
            "请在正文起始补充 > [!NOTE] 并在其内陈述【施工目标】"
        ))

    # 3. 检查「第一性原理溯源指针」章节
    has_pointer_heading = any(
        not ins and re.search(r"第一性原理.*指针", ln)
        for ln, ins in zip(lines, inside)
    )
    full_text = doc.text
    has_upstream = "精准上游规范指针" in full_text
    has_invariant = "核心不变量约束断言" in full_text
    has_instruction = any(k in full_text for k in ("最高指示", "防漂移最高指示", "业务实现最高指示", "工程化重构最高指示", "验收闭环最高指示"))
    if not (has_pointer_heading and has_upstream and has_invariant and has_instruction):
        missing_items = []
        if not has_pointer_heading: missing_items.append("## 📌 第一性原理溯源指针")
        if not has_upstream: missing_items.append("精准上游规范指针")
        if not has_invariant: missing_items.append("核心不变量约束断言")
        if not has_instruction: missing_items.append("最高指示断言")
        out.append(Finding(
            "PHASE-STAGE-STD", rel, 1,
            f"阶段细则缺少第一性原理溯源指针核心要素: {', '.join(missing_items)}",
            "请按四阶段模板补充「## 📌 第一性原理溯源指针」及其精准上游、核心不变量与最高指示"
        ))

    # 4. 检查「命令式施工执行清单」章节与复选框
    has_checklist_heading = any(
        not ins and re.search(r"命令式施工执行清单", ln)
        for ln, ins in zip(lines, inside)
    )
    has_checkbox = any(
        not ins and re.match(r"^\s*-\s*\[[\sxX]\]", ln)
        for ln, ins in zip(lines, inside)
    )
    if not (has_checklist_heading and has_checkbox):
        out.append(Finding(
            "PHASE-STAGE-STD", rel, 1,
            "阶段细则缺少「## 二、 命令式施工执行清单 (Agent Execution Checklist)」或未包含任务复选框 (- [x])",
            "请补充命令式施工执行清单及分步 Step 复选框"
        ))

    # 5. 检查「验收矩阵 (DoD Matrix)」表格
    has_dod_heading = any(
        not ins and re.search(r"(?:验收|验证)矩阵\s*\(DoD\s*Matrix\)", ln, re.IGNORECASE)
        for ln, ins in zip(lines, inside)
    )
    has_dod_table = any(
        not ins and ("检验项 ID" in ln or "检验项ID" in ln) and "预期输出断言" in ln
        for ln, ins in zip(lines, inside)
    )
    if not (has_dod_heading and has_dod_table):
        out.append(Finding(
            "PHASE-STAGE-STD", rel, 1,
            "阶段细则缺少「## 三、 ...验收矩阵 (DoD Matrix)」或表头不包含「检验项 ID」与「预期输出断言」列",
            "请按四阶段模板提供标准 DoD 矩阵表格（表头: | 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |）"
        ))

    # 6. 检查代码块健康度（PHASE-CODE-SANITY）
    for i, (ln, ins) in enumerate(zip(lines, inside)):
        if not ins:
            continue
        s = ln.strip()
        if s.startswith("#") or s.startswith("//"):
            continue
        if "push_error(" in s or "push_warning(" in s:
            out.append(Finding(
                "PHASE-CODE-SANITY", rel, i + 1,
                f"细则代码块违规包含 push_error/push_warning 散落: {s[:60]}",
                "根据统一收敛规范，细则示例代码严禁散落 push_error/push_warning，应使用 printerr 或 ErrorReporter"
            ))
        if re.search(r"\b(randf|randf_range|randi|randi_range|randomize)\s*\(", s):
            out.append(Finding(
                "PHASE-CODE-SANITY", rel, i + 1,
                f"细则代码块违规包含非确定性随机调用: {s[:60]}",
                "根据 ADV-RNG-001 规范，细则示例代码严禁调用全局 randf/randi，应使用确定性伪随机/LCG 计算"
            ))

