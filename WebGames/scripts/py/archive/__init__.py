#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 模块接口层)
# 文件路径: WebGames/scripts/py/archive/__init__.py
# 架构定位: 归档模块包初始化 (Archive Package Init)
# 依赖与触发: 触发方: archive_volume.py / 本地包导入 | 上游: archive 子模块 | 下游: 归档工具 | 运行时: Python 3.10+
# 职责说明: 暴露全宗档案治理核心类与公共接口，封装周期封存、浮标导航与元数据同步
# 退出语义与设计依据: 退出码: 纯包声明无退出码 | 设计依据: 国家标准技术档案库工程契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive import run_archive_cycle, inspect_roadmap
# ==============================================================================
"""archive — 卡拉尔世界引擎自动化归档系统。

集中导出归档系统核心路径常量、元数据 DTO、链接重写与关键词处理公共符号。"""
from archive.constants import (
    ARCHIVE_CATEGORIES,
    ARCHIVE_DIR,
    ARCHIVE_README,
    DOCS_DIR,
    FE_ARCHIVE_DIR,
    KALAR_DEV_PREFIX,
    LONG_TERM_DIR,
    MASTER_CATALOG,
    RM_ARCHIVE_DIR,
    ROADMAP_DIR,
    ROADMAP_INDEX,
    SHORT_TERM_DIR,
    ST_ARCHIVE_DIR,
    TESTS_DIR,
)
from archive.constants import ArchiveHeaderTemplate, ArchiveGovernanceConfig
from archive.constants import (
    build_att_header_template,
    build_header_template,
    resolve_responsible,
    resolve_responsible_short,
    resolve_responsible_short_from_context,
)
from archive.metadata import (
    ArchiveRecordDTO,
    int_to_cn,
    minify_markdown_text,
    resolve_file_archive_date,
    resolve_file_formation_date,
    resolve_file_formation_period,
    resolve_period_label,
    strip_existing_frontmatter,
)
from archive.links import rebase_markdown_links
from archive.keywords import (
    BOILERPLATE_BLACK_LIST,
    NOISE_WORDS,
    STOP_CLASSES,
    count_archived_inventory,
    extract_att_keywords,
    extract_keywords_from_stage_file,
    extract_stage_keywords,
    load_master_keywords,
    normalize_key,
    reindex_archive_keywords,
)
