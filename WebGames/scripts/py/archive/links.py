#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 相对链接自愈体系)
# 文件路径: WebGames/scripts/py/archive/links.py
# 架构定位: Markdown 链接拓扑重算器 (Link Topology Relinker)
# 依赖与触发: 触发方: archive_volume.py | 上游: 案卷迁移前文档 | 下游: 归档件文档 | 运行时: Python 3.10+
# 职责说明: 案卷物理迁移后深度重算全部内链与跨卷相对引用路径，确保归档后内链 100% 可达
# 退出语义与设计依据: 退出码: 纯路径重算函数无独立退出码 | 设计依据: 档案防死链与引用完整性契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.links import relink_markdown_content
# ==============================================================================
"""links.py — 归档迁移 Markdown 链接拓扑重算引擎。

提供基于拓扑真实路径与周期改名映射表的相对链接与图片链接动态重算。"""
import os
import re
from pathlib import Path
from typing import Any

from audit_common import resolve_repo_root

ROOT = resolve_repo_root()


def rebase_markdown_links(content: str, src_dir: Path, dst_dir: Path, rename_registry: dict[tuple[str, int], str] | None = None, root_dir: Path = ROOT) -> str:
    """
    基于拓扑真实路径动态重算 Markdown 内的所有相对链接与图片链接。
    优先查阅当前归档周期的 rename_registry 映射表；
    未命中时回退卷内与跨卷探测，最后回退泛化路径 relpath。
    """
    _dir_files_cache: dict[Path, list[Path]] = {}

    def _get_dir_files(d: Path) -> list[Path]:
        if d not in _dir_files_cache:
            try:
                _dir_files_cache[d] = list(d.iterdir()) if d.exists() else []
            except OSError:
                _dir_files_cache[d] = []
        return _dir_files_cache[d]

    def _replace_link(match: Any) -> str:
        prefix = match.group(1)  # '![' 或 '['
        label = match.group(2)
        link = match.group(3).strip()

        # 忽略网络链接、锚点、mailto 和空链接
        if link.startswith(("http://", "https://", "mailto:", "#")) or not link:
            return match.group(0)

        # 分离路径与锚点
        parts = link.split("#", 1)
        path_part = parts[0]
        anchor_part = f"#{parts[1]}" if len(parts) > 1 else ""

        if not path_part:
            return match.group(0)

        # 1. 优先查阅周期全局改名映射表 (CycleRenameRegistry)
        if rename_registry:
            # 1.1 卷内阶段引用：阶段X_*.md 或 KALAR-DEV-*-00X_阶段X_*.md
            if not path_part.startswith(("../", "/")):
                m_stage = re.search(r"阶段(\d)", Path(path_part).name)
                if m_stage:
                    stg_num = int(m_stage.group(1))
                    if (src_dir.name, stg_num) in rename_registry:
                        return f"{prefix}{label}]({rename_registry[(src_dir.name, stg_num)]}{anchor_part})"

            # 1.2 跨同批次案卷引用：../Phase_XX_*/阶段Y_*.md（保留原相对深度前缀）
            m_cross = re.search(r"(\.\./)+(Phase_\d+[^/]*)/([^/]+)", path_part)
            if m_cross:
                cross_phase = m_cross.group(2)
                m_stg = re.search(r"阶段(\d)", m_cross.group(3))
                if m_stg and (cross_phase, int(m_stg.group(1))) in rename_registry:
                    return f"{prefix}{label}]({m_cross.group(1)}{cross_phase}/{rename_registry[(cross_phase, int(m_stg.group(1)))]}{anchor_part})"

        # 2. 卷内阶段文件引用（同卷直连探测）：如 阶段1_xxx.md 或 KALAR-DEV-*-001_阶段1_xxx.md
        if not path_part.startswith(("../", "/")):
            target_name = Path(path_part).name
            m_stage = re.search(r"阶段(\d)", target_name)
            if m_stage:
                matched_in_dst = sorted([p for p in _get_dir_files(dst_dir) if f"阶段{m_stage.group(1)}" in p.name and p.name.endswith(".md")])
                if matched_in_dst:
                    return f"{prefix}{label}]({matched_in_dst[0].name}{anchor_part})"
            else:
                # 附件类文件兜底探测：仅当目标名确为 ATT/附件 语义时才改写，
                # 避免图片/普通同卷资源链接被误写成共享附件
                if "ATT" in target_name or "附件" in target_name:
                    att_matched = sorted([p for p in _get_dir_files(dst_dir) if "ATT" in p.name and "附件" in p.name and p.name.endswith(".md")])
                    if att_matched:
                        return f"{prefix}{label}]({att_matched[0].name}{anchor_part})"

        # 3. 跨同周期案卷引用（跨卷探测）：如 ../Phase_47_xxx/阶段1_xxx.md（保留原相对深度前缀）
        m_cross_phase = re.search(r"(\.\./)+(Phase_\d+[^/]*)/([^/]+)", path_part)
        if m_cross_phase:
            target_phase_dir = dst_dir.parent / m_cross_phase.group(2)
            if target_phase_dir.exists():
                target_file_name = m_cross_phase.group(3)
                m_stg = re.search(r"阶段(\d)", target_file_name)
                if m_stg:
                    cross_matched = sorted([p for p in _get_dir_files(target_phase_dir) if f"阶段{m_stg.group(1)}" in p.name and p.name.endswith(".md")])
                    if cross_matched:
                        return f"{prefix}{label}]({m_cross_phase.group(1)}{m_cross_phase.group(2)}/{cross_matched[0].name}{anchor_part})"
                else:
                    # 附件类文件跨卷兜底探测（同样仅限 ATT/附件 语义目标）
                    target_cross_name = Path(target_file_name).name
                    if "ATT" in target_cross_name or "附件" in target_cross_name:
                        att_cross = sorted([p for p in _get_dir_files(target_phase_dir) if "ATT" in p.name and "附件" in p.name and p.name.endswith(".md")])
                        if att_cross:
                            return f"{prefix}{label}]({m_cross_phase.group(1)}{m_cross_phase.group(2)}/{att_cross[0].name}{anchor_part})"

        # 4. 泛化跨目录相对路径重算
        abs_target = (src_dir / path_part).resolve()

        try:
            abs_target.relative_to(root_dir)
            new_rel = os.path.relpath(abs_target, dst_dir).replace("\\", "/")
            return f"{prefix}{label}]({new_rel}{anchor_part})"
        except ValueError:
            return match.group(0)

    pattern = r"(!?\[)([^\]]*?)\]\(([^)]+)\)"
    return re.sub(pattern, _replace_link, content)
