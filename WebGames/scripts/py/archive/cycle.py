#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 归档生命周期中枢)
# 文件路径: WebGames/scripts/py/archive/cycle.py
# 架构定位: 案卷封存状态机控制器 (Volume Archival Cycle Controller)
# 依赖与触发: 触发方: archive_volume.py | 上游: 短期施工区在途案卷 | 下游: 03_短期施工档案卷 | 运行时: Python 3.10+
# 职责说明: 编排 10 卷周期性自动封存状态机，执行案卷目录迁移、总索引清除与周期摘要重建
# 退出语义与设计依据: 退出码: 纯业务控制器无独立退出码 | 设计依据: 10卷一封存强契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.cycle import run_cycle_archival
# ==============================================================================
"""cycle.py — 短期施工区十卷周期归档主流程与元数据全量同步。

负责周期归档前置特化校验、目录移动、文件重命名、14 项头块签发、
ATT 附件生成、卷内导航注入以及全宗元数据库与总索引同步更新。"""
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

from audit_common import KALAR_DEV_PREFIX, resolve_repo_root
from archive.attachment import generate_volume_attachment, inject_att_pointer, inject_volume_navbars
from archive.constants import (
    MASTER_CATALOG,
    ROADMAP_INDEX,
    SHORT_TERM_DIR,
    ST_ARCHIVE_DIR,
    build_header_template,
    resolve_responsible,
)
from archive.keywords import (
    count_archived_inventory,
    extract_keywords_from_stage_file,
)
from archive.links import rebase_markdown_links
from archive.metadata import (
    ArchiveRecordDTO,
    minify_markdown_text,
    resolve_file_archive_date,
    resolve_file_formation_date,
    resolve_file_formation_period,
    resolve_period_label,
    strip_existing_frontmatter,
)
from archive.verify import verify_stage_distinctness

ROOT = resolve_repo_root()


def _phase_num_of(vol_dir: Path) -> int:
    """从案卷目录名解析真实 Phase 号（Phase_NN_ 约定，失败即阻断）。

    模块级助手：供 archive_short_term_cycle 与 sync_metadata_after_cycle 共用，
    避免后者引用兄弟函数局部变量导致的 NameError（P1 修复）。
    """
    m = re.match(r"Phase_(\d+)_", vol_dir.name)
    if not m:
        raise ValueError(f"案卷目录名不符合 Phase_N_ 约定: {vol_dir.name}")
    return int(m.group(1))


def _validate_vols_and_stages(vols_to_archive: list[Path], start_idx: int) -> bool:
    """归档前校验各案卷阶段完整性。"""
    for i, sv in enumerate(vols_to_archive):
        global_vol_num = start_idx + i
        st_id = f"ST{global_vol_num:02d}"
        stages = sorted([f for f in sv.glob("*.md") if "阶段" in f.name])
        ok, msg = verify_stage_distinctness(stages)
        if not ok:
            print(f"  ❌ 案卷 {sv.name} 校验未通过: {msg}，阻断归档！")
            return False
        print(f"  · 案卷 {st_id} ({sv.name}) ➔ 4 阶段文件 + 1 ATT 附件生成与致密化压缩")
    return True


def _build_cycle_rename_registry(vols_to_archive: list[Path], start_idx: int) -> dict[tuple[str, int], str]:
    """预构建当前周期全量 10 卷文件重命名映射表 (CycleRenameRegistry)。"""
    cycle_rename_registry: dict[tuple[str, int], str] = {}
    for i, sv in enumerate(vols_to_archive):
        global_vol_num = start_idx + i
        st_id = f"ST{global_vol_num:02d}"
        orig_stages = sorted([f for f in sv.glob("*.md") if "阶段" in f.name and "ATT" not in f.name])
        for sf in orig_stages:
            m = re.search(r"阶段(\d)_(.+)\.md$", sf.name)
            if m:
                s_num = int(m.group(1))
                s_title = m.group(2)
                p_code = f"{s_num:03d}"
                new_f_name = f"{KALAR_DEV_PREFIX}-{st_id}-{p_code}_阶段{s_num}_{s_title}.md"
                cycle_rename_registry[(sv.name, s_num)] = new_f_name
    return cycle_rename_registry


def _archive_single_stage_file(
    sf: Path,
    dst_vol_dir: Path,
    sv: Path,
    st_id: str,
    today: str,
    annual_year: str,
    att_name: str,
    cycle_rename_registry: dict[tuple[str, int], str],
) -> tuple[bool, bool]:
    """重命名、链接附件并致密化压缩单个阶段文件。返回 (att_hit, sync_ok)"""
    m = re.search(r"阶段(\d)_(.+)\.md$", sf.name)
    if not m:
        return True, True
    stage_num = int(m.group(1))
    stage_title = m.group(2)
    piece = f"{stage_num:03d}"
    new_file_name = f"{KALAR_DEV_PREFIX}-{st_id}-{piece}_阶段{stage_num}_{stage_title}.md"
    dst_file = dst_vol_dir / new_file_name

    sf.rename(dst_file)
    content = dst_file.read_text(encoding="utf-8")
    content = rebase_markdown_links(content, sv, dst_vol_dir, cycle_rename_registry)

    content, att_hit = inject_att_pointer(content, att_name)
    if not att_hit:
        print(f"    ⚠️ 锚点未命中：{new_file_name}，ATT 指针未注入，请人工核对")

    formation_date = resolve_file_formation_date(dst_file)
    archive_date = resolve_file_archive_date(today)
    archive_period = resolve_period_label(datetime.now().hour)
    formation_period = resolve_file_formation_period(dst_file)

    sync_ok = formation_date < archive_date or (
        formation_date == archive_date and formation_period is not None
        and formation_period != archive_period
    )
    if not sync_ok:
        print(f"    ⚠️ 【形成/归档日期同步】{sv.name} 阶段{stage_num} 形成日期与归档日期相同（归档当天现写或缺少形成时间戳，施工完成度存疑，请人工核对）")

    keywords = extract_keywords_from_stage_file(dst_file, sv.name, stage_num, stage_title)
    responsible = resolve_responsible(sv.name)
    header = build_header_template(annual_year).format(
        archive_code=f"{KALAR_DEV_PREFIX}-{st_id}-{piece}",
        st_id=st_id,
        vol_name=sv.name,
        piece=piece,
        responsible=responsible,
        stage_num=stage_num,
        stage_title=stage_title,
        formation_date=formation_date,
        archive_date=archive_date,
        archive_period=archive_period,
        keywords=keywords,
    )
    body_content = strip_existing_frontmatter(content)
    final_content = minify_markdown_text(header + body_content)
    dst_file.write_text(final_content, encoding="utf-8", newline="\n")
    return att_hit, sync_ok


def _archive_single_volume(
    sv: Path,
    target_cycle_dir: Path,
    st_id: str,
    today: str,
    annual_year: str,
    cycle_rename_registry: dict[tuple[str, int], str],
) -> int:
    """移动案卷目录并归档其中的附件与阶段文件，返回该卷 anchor_missed 次数。"""
    dst_vol_dir = target_cycle_dir / sv.name
    subprocess.run(
        ["git", "mv", sv.relative_to(ROOT).as_posix(), dst_vol_dir.relative_to(ROOT).as_posix()],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=120
    )
    if not dst_vol_dir.exists():
        sv.rename(dst_vol_dir)

    att_path = generate_volume_attachment(dst_vol_dir, st_id, sv.name, today, annual_year)
    att_name = att_path.name

    stages = sorted([f for f in dst_vol_dir.glob("*.md") if "阶段" in f.name and "ATT" not in f.name])
    missed_count = 0
    for sf in stages:
        att_hit, _ = _archive_single_stage_file(
            sf, dst_vol_dir, sv, st_id, today, annual_year, att_name, cycle_rename_registry
        )
        if not att_hit:
            missed_count += 1

    inject_volume_navbars(dst_vol_dir, st_id)
    return missed_count


def _run_post_archive_docs_audit() -> bool:
    """执行归档后全库文档与链接完整性自检 (audit_docs)。"""
    print("\n🔍 正在执行归档后全库文档与链接完整性自检 (audit_docs)...")
    audit_script = ROOT / "scripts" / "py" / "audit_docs.py"
    if not audit_script.exists():
        return True
    r = subprocess.run([sys.executable, str(audit_script)], capture_output=True, text=True, encoding="utf-8", timeout=300)
    if r.returncode == 0:
        print("  ✅ 归档后全库文档自检 100% 通过（0 error / 0 warn）！")
        return True
    print("  ❌ 【致命错误】归档后文档完整性门禁未通过，发现以下违规:")
    for line in r.stdout.splitlines()[-15:]:
        print(f"    {line}")
    print("\n🚨 归档操作产生文档规范或死链违规！操作阻断。请排查修复上述问题或执行 git restore 回滚。")
    return False


def archive_short_term_cycle(apply: bool) -> bool:
    """对短期施工区已满 10 卷的案卷执行周期性批量归档。"""
    short_term_vols = sorted([d for d in SHORT_TERM_DIR.glob("Phase_*") if d.is_dir()], key=_phase_num_of) if SHORT_TERM_DIR.exists() else []

    if len(short_term_vols) < 10:
        print(f"【archive-cycle】当前短期施工区案卷数为 {len(short_term_vols)} / 10，未达到周期归档阈值（每 10 卷一个归档周期）。")
        return False

    vols_to_archive = short_term_vols[:10]
    st_cycles = sorted(ST_ARCHIVE_DIR.glob("第*期_*")) if ST_ARCHIVE_DIR.exists() else []
    cycle_num = len(st_cycles) + 1
    start_idx = (cycle_num - 1) * 10 + 1

    start_phase = _phase_num_of(vols_to_archive[0])
    end_phase = _phase_num_of(vols_to_archive[-1])
    if end_phase - start_phase != len(vols_to_archive) - 1:
        raise ValueError(
            f"待归档案卷 Phase 序号不连续: {start_phase}..{end_phase}（共 {len(vols_to_archive)} 卷），"
            "序号门禁要求连续无跳号，阻断归档！"
        )
    cycle_dir_name = f"第{cycle_num:02d}期_{start_phase:02d}到{end_phase:02d}"
    target_cycle_dir = ST_ARCHIVE_DIR / cycle_dir_name

    print(f"【archive-cycle】准备执行短期施工区第 {cycle_num:02d} 期归档 ➔ {target_cycle_dir.name} {'[干跑]' if not apply else '[执行]'}:")

    if not _validate_vols_and_stages(vols_to_archive, start_idx):
        return False

    if not apply:
        print("\n提示：添加 --apply 参数以实际执行周期归档与总索引更新。")
        return True

    target_cycle_dir.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    annual_year = f"{today[:4]}年"
    cycle_rename_registry = _build_cycle_rename_registry(vols_to_archive, start_idx)

    anchor_missed_total = 0
    for i, sv in enumerate(vols_to_archive):
        global_vol_num = start_idx + i
        st_id = f"ST{global_vol_num:02d}"
        anchor_missed_total += _archive_single_volume(
            sv, target_cycle_dir, st_id, today, annual_year, cycle_rename_registry
        )

    sync_metadata_after_cycle(cycle_num, start_idx, cycle_dir_name, vols_to_archive, today, start_phase, end_phase)

    if not _run_post_archive_docs_audit():
        return False

    if anchor_missed_total >= 2:
        print(f"  ❌ 【锚点注入降级】全周期共 {anchor_missed_total} 处 anchor_missed，超出容忍阈值，归档退出码升为 1 留人工核验！")
        print("  👉 请人工补齐缺失的【施工目标】锚点或 ATT 指针后重跑归档校验。")
        return False

    print(f"🎉 成功完成第 {cycle_num:02d} 期 10 卷短期施工案卷归档（含 50 份致密化档案件）！")
    return True


def _sync_master_catalog(
    cat_counts: dict,
    total_vols: int,
    total_pieces: int,
    total_st_vols: int,
    st_cycles: list[Path],
    cycle_dir_name: str,
    vols_to_archive: list[Path],
    start_idx: int,
) -> None:
    """更新卡拉尔全宗档案总目录与元数据库.md。"""
    if not MASTER_CATALOG.exists():
        return
    cat_text = MASTER_CATALOG.read_text(encoding="utf-8")
    preamble_line = (
        f"> **档案总量**：**{total_vols} 大案卷（后端 RM01~{cat_counts.get('DEV-RM', 0):02d} + "
        f"前端 FE01~{cat_counts.get('DEV-FE', 0):02d} + 短期 ST01~{total_st_vols:02d}）、{total_pieces} 件**。"
        f"已归档口径：**后端 {cat_counts.get('DEV-RM', 0)} 卷 {cat_counts.get('DEV-RM', 0)*4} 件已全量封存**于 `01_施工路线图档案卷/`（档号 `{KALAR_DEV_PREFIX}-RM01~RM{cat_counts.get('DEV-RM', 0):02d}`）；"
        f"**前端 {cat_counts.get('DEV-FE', 0)} 卷 {cat_counts.get('DEV-FE', 0)*4} 件已全量封存**于 `02_前端施工档案卷/`（档号 `{KALAR_DEV_PREFIX}-FE01~FE{cat_counts.get('DEV-FE', 0):02d}`）；"
        f"**短期施工已封存 {len(st_cycles)} 个周期共 {total_st_vols} 卷 {total_st_vols * 4} 件正件 + {total_st_vols} 件共享上下文附件**于 `03_短期施工档案卷/`（档号 `{KALAR_DEV_PREFIX}-ST01~ST{total_st_vols:02d}`）。"
        f"题名列只含阶段主题，卷题由案卷号与直达链接路径承载——**Agent 定位文件请用 `scripts/py/audit_docs.py --manifest` 单行 grep 或路径 glob，勿通读本表**。\n"
    )
    cat_text = re.sub(r"> \*\*档案总量\*\*：\*\*\d+ 大案卷.*?\n", preamble_line, cat_text)
    table_heading = f"## 📊 全宗技术档案检索总表 ({total_vols} 大案卷 · {total_pieces} 件)\n"
    cat_text = re.sub(r"## 📊 全宗.*?技术档案检索总表.*?\n", table_heading, cat_text)

    lines = cat_text.splitlines()
    existing_codes = set(re.findall(r"`(KALAR-DEV-\d{4}-ST\d{2,3}-[A-Z0-9]+)`", cat_text))
    current_seq = len([l for l in lines if l.startswith("|") and not l.startswith("| 序号") and not l.startswith("| :---")])
    new_lines: list[str] = []

    for i, sv in enumerate(vols_to_archive):
        global_vol_num = start_idx + i
        st_id = f"ST{global_vol_num:02d}"
        vol_target_dir = ST_ARCHIVE_DIR / cycle_dir_name / sv.name

        att_files = list(vol_target_dir.glob("*ATT*.md"))
        if att_files:
            att_file = att_files[0]
            att_code = f"{KALAR_DEV_PREFIX}-{st_id}-ATT"
            if att_code not in existing_codes:
                current_seq += 1
                rel_path = f"03_短期施工档案卷/{cycle_dir_name}/{sv.name}/{att_file.name}"
                record = ArchiveRecordDTO.from_file(att_file, current_seq, rel_path)
                new_lines.append(record.to_markdown_row())

        stages = sorted([f for f in vol_target_dir.glob("*.md") if "阶段" in f.name and "ATT" not in f.name])
        for stage_file in stages:
            m = re.search(KALAR_DEV_PREFIX + r"-(ST\d{2,3})-(\d{3})_阶段(\d)_(.+)\.md$", stage_file.name)
            if not m:
                continue
            code = f"{KALAR_DEV_PREFIX}-{st_id}-{m.group(2)}"
            if code in existing_codes:
                continue
            current_seq += 1
            rel_path = f"03_短期施工档案卷/{cycle_dir_name}/{sv.name}/{stage_file.name}"
            record = ArchiveRecordDTO.from_file(stage_file, current_seq, rel_path)
            new_lines.append(record.to_markdown_row())

    if new_lines:
        cat_text = cat_text.rstrip("\n") + "\n" + "\n".join(new_lines) + "\n"
    MASTER_CATALOG.write_text(minify_markdown_text(cat_text), encoding="utf-8", newline="\n")
    print("  · 自动同步 卡拉尔全宗档案总目录与元数据库.md 元数据（含 ATT 附件）")


def _sync_short_term_archive_readme(st_cycles: list[Path], end_phase: int) -> None:
    """更新 docs/归档库/03_短期施工档案卷/README.md 目录树结构。"""
    st_readme = ST_ARCHIVE_DIR / "README.md"
    if not st_readme.exists():
        return
    next_cycle = len(st_cycles) + 1
    remaining_vols = len([d for d in SHORT_TERM_DIR.glob("Phase_*") if d.is_dir()]) if SHORT_TERM_DIR.exists() else 0
    in_flight_first = sorted([d for d in SHORT_TERM_DIR.glob("Phase_*") if d.is_dir()], key=_phase_num_of)[:1]
    next_start = _phase_num_of(in_flight_first[0]) if in_flight_first else end_phase + 1
    next_end = next_start + 9

    tree_lines = ["docs/归档库/03_短期施工档案卷/"]
    for c in st_cycles:
        vols = sorted([v.name for v in c.glob("Phase_*")], key=lambda n: int(re.search(r"Phase_(\d+)_", n).group(1)) if re.search(r"Phase_(\d+)_", n) else 0)
        tree_lines.append(f"├── {c.name}/                        # 归档周期 (收录 {len(vols)} 案卷 · ✅ 已封存)")
        for v in vols:
            tree_lines.append(f"│   ├── {v}/")
    tree_lines.append(f"├── 第{next_cycle:02d}期_{next_start:02d}到{next_end:02d}/                        # 归档周期第 {next_cycle} 期 (⏳ 积累中: {remaining_vols}/10)")
    tree_lines.append("└── ...")

    tree_block = "```\n" + "\n".join(tree_lines) + "\n```"
    readme_text = st_readme.read_text(encoding="utf-8")
    readme_text = re.sub(r"```\ndocs/归档库/03_短期施工档案卷/.*?\n```", tree_block, readme_text, flags=re.DOTALL)
    st_readme.write_text(minify_markdown_text(readme_text), encoding="utf-8", newline="\n")
    print("  · 自动同步 03_短期施工档案卷/README.md 目录树结构")


def _sync_roadmap_index(
    cat_counts: dict,
    total_vols: int,
    total_st_vols: int,
    st_cycles: list[Path],
    vols_to_archive: list[Path],
    start_phase: int,
    cycle_num: int,
) -> None:
    """更新 docs/路线图/路线图总索引.md 看板与下一施工起点。"""
    if not ROADMAP_INDEX.exists():
        return
    rm_text = ROADMAP_INDEX.read_text(encoding="utf-8")
    next_cycle = len(st_cycles) + 1
    remaining_vols = len([d for d in SHORT_TERM_DIR.glob("Phase_*") if d.is_dir()]) if SHORT_TERM_DIR.exists() else 0

    for sv in vols_to_archive:
        m_num = re.search(r"Phase[_\s](\d+)", sv.name)
        if not m_num:
            continue
        phase_no = m_num.group(1)
        heading = re.search(rf"\n###[^\n]*\bPhase\s*{re.escape(phase_no)}\b[^\n]*\n", rm_text)
        if heading:
            sep_idx = rm_text.find("\n---\n", heading.end() - 1)
            if sep_idx >= 0:
                rm_text = rm_text[:heading.start()] + "\n" + rm_text[sep_idx + len("\n---\n"):]

    rm_text = re.sub(
        r"> 全域 \*\*\d+ 大已验收历史案卷.*?\n",
        f"> 全域 **{total_vols} 大已验收历史案卷（后端{cat_counts.get('DEV-RM', 0)}卷 + 前端{cat_counts.get('DEV-FE', 0)}卷 + 短期已归档{total_st_vols}卷）** 已全量归入国家标准技术档案库：👉 [卡拉尔全宗档案总目录与元数据库.md](../归档库/卡拉尔全宗档案总目录与元数据库.md)。\n",
        rm_text
    )
    rm_text = re.sub(
        r"> \*\*【当前归档周期进度】\*\*：.*?\n",
        f"> **【当前归档周期进度】**：第 {next_cycle:02d} 期（在途积累: {remaining_vols}/10 案卷）。每积累 10 卷触发一次周期性自动封存。\n",
        rm_text
    )

    remaining_dirs = sorted([d for d in SHORT_TERM_DIR.glob("Phase_*") if d.is_dir()]) if SHORT_TERM_DIR.exists() else []
    arch_phase_nums = sorted(
        int(re.search(r"Phase[_\s](\d+)", v.name).group(1))
        for v in vols_to_archive if re.search(r"Phase[_\s](\d+)", v.name)
    )
    last_arch_phase = arch_phase_nums[-1] if arch_phase_nums else start_phase
    if remaining_dirs:
        max_phase = max(int(re.search(r"Phase[_\s](\d+)", d.name).group(1)) for d in remaining_dirs)
        next_phase = max_phase + 1
    else:
        next_phase = last_arch_phase + 1
    next_start_marker = (
        f"> 📌 **下一施工起点**：第 {cycle_num:02d} 期归档已封存（清理至 Phase {last_arch_phase}），"
        f"后续施工请从 **Phase {next_phase}** 开始（下一新卷编号）。\n"
    )
    if "下一施工起点" in rm_text:
        rm_text = re.sub(r"> 📌 \*\*下一施工起点\*\*：.*?\n", next_start_marker, rm_text)
    else:
        rm_text = re.sub(
            r"(> \*\*【当前归档周期进度】\*\*：.*?\n)",
            r"\1" + next_start_marker,
            rm_text
        )

    st_pointer = f"* 📦 **03 短期施工档案卷 (ST01~ST{total_st_vols:02d})**：已封存 {len(st_cycles)} 个周期共 {total_st_vols} 卷（共 {total_st_vols * 4} 阶段正件 + {total_st_vols} 件共享附件）标准化施工细则已全量归档于 [03_短期施工档案卷/](../归档库/03_短期施工档案卷/)；"
    if "* 📦 **03 短期施工档案卷" in rm_text:
        rm_text = re.sub(r"\* 📦 \*\*03 短期施工档案卷.*?\n", st_pointer + "\n", rm_text)
    else:
        rm_text = re.sub(
            r"(\* 🎨 \*\*02 前端施工档案卷)",
            st_pointer + "\n\\1",
            rm_text
        )

    ROADMAP_INDEX.write_text(minify_markdown_text(rm_text), encoding="utf-8", newline="\n")
    print("  · 自动同步 路线图总索引.md（完成已归档案卷看板压缩与去重）")


def sync_metadata_after_cycle(
    cycle_num: int,
    start_idx: int,
    cycle_dir_name: str,
    vols_to_archive: list[Path],
    today: str,
    start_phase: int = 0,
    end_phase: int = 0,
) -> None:
    """自动更新卡拉尔全宗档案总目录、03_短期施工档案卷 README、01_短期施工区 README 以及路线图总索引。"""
    cat_counts, total_vols, total_pieces = count_archived_inventory(force_refresh=True)
    st_cycles = sorted(ST_ARCHIVE_DIR.glob("第*期_*")) if ST_ARCHIVE_DIR.exists() else []
    total_st_vols = cat_counts.get("DEV-ST", 0)

    _sync_master_catalog(
        cat_counts, total_vols, total_pieces, total_st_vols,
        st_cycles, cycle_dir_name, vols_to_archive, start_idx
    )
    _sync_short_term_archive_readme(st_cycles, end_phase)
    _sync_roadmap_index(
        cat_counts, total_vols, total_st_vols,
        st_cycles, vols_to_archive, start_phase, cycle_num
    )
