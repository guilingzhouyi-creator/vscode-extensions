#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 主题词标引体系)
# 文件路径: WebGames/scripts/py/archive/keywords.py
# 架构定位: 关键词提取与分类器 (Keyword & Topic Classifier)
# 依赖与触发: 触发方: archive_volume.py | 上游: 细则正文 | 下游: 档案元数据 | 运行时: Python 3.10+
# 职责说明: 基于规则与倒排词表，从施工细则与变更日志中自动化提取领域主题词与特征标签
# 退出语义与设计依据: 退出码: 纯分析函数无独立退出码 | 设计依据: 档案检索国家标准标引契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.keywords import extract_volume_keywords
# ==============================================================================
"""keywords.py — 归档关键词语义提取、全宗聚合与全量重构引擎。

提供细则正文智能主题词提取、停用词与样板过滤、全宗元数据聚合统计
以及归档库关键词全量重构与总目录同步功能。"""
import re
from pathlib import Path

from archive.constants import (
    BOILERPLATE_BLACK_LIST,
    FE_ARCHIVE_DIR,
    KALAR_DEV_PREFIX,
    MASTER_CATALOG,
    NOISE_WORDS,
    RM_ARCHIVE_DIR,
    ST_ARCHIVE_DIR,
    STOP_CLASSES,
)
from archive.metadata import minify_markdown_text

_INVENTORY_CACHE: tuple[dict[str, int], int, int] | None = None


def count_archived_inventory(force_refresh: bool = False) -> tuple[dict[str, int], int, int]:
    """
    动态全宗聚合器：扫描归档库下所有分类目录，动态计算总案卷数与总件数。
    返回: (各分类案卷数字典, 总案卷数, 总件数)
    """
    global _INVENTORY_CACHE
    if _INVENTORY_CACHE is not None and not force_refresh:
        return _INVENTORY_CACHE

    cat_counts = {}
    total_vols = 0
    total_pieces = 0

    # 1. 扫描 RM 案卷
    if RM_ARCHIVE_DIR.exists():
        rm_vols = sorted(RM_ARCHIVE_DIR.glob("卷*_*"))
        cat_counts["DEV-RM"] = len(rm_vols)
        total_vols += len(rm_vols)
        total_pieces += len(list(RM_ARCHIVE_DIR.rglob(KALAR_DEV_PREFIX + "-RM*.md")))
    else:
        cat_counts["DEV-RM"] = 0

    # 2. 扫描 FE 案卷
    if FE_ARCHIVE_DIR.exists():
        fe_vols = sorted(FE_ARCHIVE_DIR.glob("前端_第*卷_*"))
        cat_counts["DEV-FE"] = len(fe_vols)
        total_vols += len(fe_vols)
        total_pieces += len(list(FE_ARCHIVE_DIR.rglob(KALAR_DEV_PREFIX + "-FE*.md")))
    else:
        cat_counts["DEV-FE"] = 0

    # 3. 扫描 ST 案卷
    if ST_ARCHIVE_DIR.exists():
        st_vols = list(ST_ARCHIVE_DIR.rglob("Phase_*"))
        cat_counts["DEV-ST"] = len(st_vols)
        total_vols += len(st_vols)
        total_pieces += len(list(ST_ARCHIVE_DIR.rglob(KALAR_DEV_PREFIX + "-ST*.md")))
    else:
        cat_counts["DEV-ST"] = 0

    if total_pieces == 0:
        total_pieces = total_vols * 4

    _INVENTORY_CACHE = (cat_counts, total_vols, total_pieces)
    return _INVENTORY_CACHE


def load_master_keywords() -> dict[str, dict[str, str]]:
    """从总目录泛化解析各卷各件的主题词。返回 {id: {piece: kw}}"""
    if not MASTER_CATALOG.exists():
        return {}
    cat_text = MASTER_CATALOG.read_text(encoding="utf-8")
    kw_map = {}
    for line in cat_text.splitlines():
        m = re.search(r"`KALAR-DEV-\d{4}-([A-Z0-9]+)-([A-Z0-9]+)`\s*\|\s*`([^`]+)`\s*\|\s*`[^`]+`\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|", line)
        if m:
            vol_id = m.group(1)
            piece = m.group(2)
            keywords = m.group(9).strip()
            kw_map.setdefault(vol_id, {})[piece] = keywords
    return kw_map


def normalize_key(s: str) -> str:
    """去除所有下划线、空格、连字符并转小写，供跨驼峰/蛇形无歧义去重。"""
    return re.sub(r"[\s_\-/\\]+", "", s).lower()


def clean_term(t: str) -> str:
    """清理提取出的词汇：移除 Markdown、序号、首尾标点、无效前缀与路径。"""
    t = re.sub(r"[`*#]", "", t)  # 保持下划线供代码标识符与文件名使用
    t = re.sub(r"^[0-9一二三四五六七八九十]+[、.\s]+", "", t)
    t = re.sub(r"^\d+(?:\.\d+)*[、.\s]+\s*", "", t)  # 剥离 1.1 / 2.1 等小节编号
    t = re.sub(r"^[(（](.*)[)）]$", r"\1", t)
    t = re.sub(r"^(?:设计|构建|实现|建立|完成|重构|制定|全面贯彻|引入|落实|规范|确立|扩展|新增|推进|支撑)\s*", "", t)
    t = re.sub(r"\s*(?:→|➔|->|=>)\s*", "与", t)
    # 剥离前置路径
    t = re.sub(r"^(?:config|docs|scripts)/[a-zA-Z0-9_\-/]+/", "", t)
    t = re.sub(r"^(?:config|docs|scripts)/", "", t)
    t = t.strip(" ：:;；,，()（）`* \t\r\n/")
    return t


def extract_stage_keywords(file_path: Path, vol_dir_name: str, stage_num: int, stage_title: str) -> list[str]:
    """智能语义提取细则的主题词，深度根据正文实际内容自动归纳，彻底杜绝样板同质化。"""
    try:
        text = file_path.read_text(encoding="utf-8")
    except Exception:
        text = ""

    candidates: list[str] = []
    seen = set()

    def add_cand(cand: str) -> None:
        c = clean_term(cand)
        if not c or len(c) < 2 or len(c) > 35:
            return
        if c.lower() in NOISE_WORDS or c in STOP_CLASSES or c in BOILERPLATE_BLACK_LIST:
            return
        # 过滤纯脚本文件扩展名与路径引用
        if c.endswith(".md") or c.endswith(".py") or c.endswith(".sh") or c.endswith(".ps1") or c.endswith(".gd"):
            return
        if "/" in c or "\\" in c:
            return
        for bp in BOILERPLATE_BLACK_LIST:
            if c == bp or (len(c) > 4 and bp in c):
                return

        # 拆分带有 .json 的混合句子（如 account.json 注册规则与错误码扩展）
        if ".json" in c and not c.endswith(".json"):
            m_cfg = re.search(r"([a-z0-9_]+\.json)", c)
            if m_cfg:
                cfg_name = m_cfg.group(1)
                norm_cfg = normalize_key(cfg_name)
                if norm_cfg not in seen:
                    seen.add(norm_cfg)
                    candidates.append(cfg_name)
                rest = clean_term(c.replace(cfg_name, ""))
                if rest and len(rest) > 2:
                    add_cand(rest)
            return

        norm = normalize_key(c)
        if norm in seen:
            return
        seen.add(norm)
        candidates.append(c)

    # 1. 提取声明的代码实体 (class_name, class XDTO/Service/Engine/Gate/Pipeline)
    code_classes = re.findall(r"(?:class_name|class)\s+([A-Z][a-zA-Z0-9_]+)", text)
    for cls in code_classes:
        if cls not in STOP_CLASSES and cls.lower() not in NOISE_WORDS:
            add_cand(cls)

    # 2. 从【施工目标】/【核心职责】/【阶段目标】列表中提取具体目标实体
    target_block = re.search(r"(?:【施工目标】|【核心职责】|【阶段目标】)[：:]\s*(.+?)(?:\n---|\n##|\Z)", text, re.DOTALL)
    if target_block:
        for ln in target_block.group(1).splitlines():
            ln = ln.strip()
            m_item = re.search(r">\s*\d+[\.、]\s*([^：:\n（(]+)(?:[（(]([^）)]+)[）)])?", ln)
            if m_item:
                noun_phrase = m_item.group(1)
                paren_phrase = m_item.group(2) if m_item.group(2) else ""
                if paren_phrase:
                    for cid in re.findall(r"`?([A-Za-z0-9_]+)`?", paren_phrase):
                        if len(cid) > 2 and cid not in ("gd", "json") and cid.lower() not in NOISE_WORDS:
                            add_cand(cid)
                add_cand(noun_phrase)

    # 3. 提取 ### 小节标题（包含具体算法、模型与服务名）
    for h3 in re.findall(r"^###\s+(.+)$", text, re.MULTILINE):
        m_paren = re.search(r"^(.*?)[（(]([^）)]+)[）)]\s*$", h3)
        if m_paren:
            zh_part = m_paren.group(1)
            en_part = m_paren.group(2)
            for en_tok in re.findall(r"`?([A-Za-z0-9_]+)`?", en_part):
                if len(en_tok) > 3 and en_tok not in ("gdscript", "json") and en_tok.lower() not in NOISE_WORDS:
                    add_cand(en_tok)
            add_cand(zh_part)
        else:
            add_cand(h3)

    # 4. 提取核心不变量描述
    for inv_name in re.findall(r"Inv-[A-Z0-9]+-\d+\s*(?:[（(]([^）)]+)[）)])?", text):
        if inv_name and len(inv_name) >= 2 and inv_name.lower() not in NOISE_WORDS:
            add_cand(inv_name)

    # 5. 提取特征配置文件
    for cfg in re.findall(r"`?([a-z_0-9]+\.json)`?", text):
        if cfg not in ("package.json", "tsconfig.json"):
            add_cand(cfg)

    # 6. 若结果不足，从阶段标题分解补充
    clean_stage_title = re.sub(r"^阶段\d[：:_]\s*", "", stage_title)
    if len(candidates) < 3:
        for seg in re.split(r"[与和与及、]", clean_stage_title):
            add_cand(seg)

    # 7. 兜底
    clean_vol = re.sub(r"^Phase_\d+_", "", vol_dir_name).replace("_", " ")
    if not candidates:
        candidates = [clean_vol, clean_stage_title]

    def sort_key(kw: str) -> int:
        if re.match(r"^[A-Z][A-Za-z0-9_]+$", kw):
            return 1  # Class / DTO
        if kw.endswith(".json"):
            return 3  # Config
        return 2      # Domain phrase

    sorted_cands = sorted(candidates, key=sort_key)
    classes = [c for c in sorted_cands if sort_key(c) == 1]
    phrases = [c for c in sorted_cands if sort_key(c) == 2]
    configs = [c for c in sorted_cands if sort_key(c) == 3]

    result: list[str] = []
    if classes:
        result.extend(classes[:2])
    if phrases:
        result.extend(phrases[:3])
    if configs and len(result) < 5:
        result.append(configs[0])

    if not result:
        result = [clean_vol, clean_stage_title]

    return result[:5]


def extract_keywords_from_stage_file(file_path: Path, vol_dir_name: str, stage_num: int, stage_title: str) -> str:
    """智能语义提取细则的主题词（字符串接口，分号连接）。"""
    kws = extract_stage_keywords(file_path, vol_dir_name, stage_num, stage_title)
    return "; ".join(kws)


def extract_att_keywords(vol_dir: Path, vol_name: str, st_id: str) -> list[str]:
    """提取案卷级共享附件 (ATT) 的特化主题词，杜绝硬编码同质化。"""
    clean_vol = re.sub(r"^Phase_\d+_", "", vol_name).replace("_", " ")
    stages = sorted([f for f in vol_dir.glob("*.md") if "阶段" in f.name and "ATT" not in f.name])
    all_kws = []
    for sf in stages:
        m = re.search(r"阶段(\d)_(.+)\.md$", sf.name)
        if m:
            s_num = int(m.group(1))
            s_title = m.group(2)
            kws = extract_stage_keywords(sf, vol_name, s_num, s_title)
            all_kws.extend(kws)

    seen = set()
    dedup = []
    for k in all_kws:
        norm = normalize_key(k)
        if norm not in seen:
            seen.add(norm)
            dedup.append(k)

    att_kws = [clean_vol]
    classes = [k for k in dedup if re.match(r"^[A-Z][A-Za-z0-9_]+$", k)]
    phrases = [k for k in dedup if not re.match(r"^[A-Z][A-Za-z0-9_]+$", k) and not k.endswith(".json")]

    if classes:
        att_kws.extend(classes[:2])
    if phrases:
        att_kws.extend(phrases[:2])
    att_kws.append("案卷共享契约与上下文")
    return att_kws[:5]


def reindex_archive_keywords(target_cycle: str = None, apply: bool = True) -> bool:
    """
    根据实际文件内容全量重新归纳提纯归档库案卷的关键词：
    1. 重新提纯各阶段文件与 ATT 附件的 YAML Frontmatter 主题词/关键词（杜绝同质化与尾部阶段名残留）；
    2. 全量同步更新 docs/归档库/卡拉尔全宗档案总目录与元数据库.md 中的主题词/关键词列。
    """
    if not ST_ARCHIVE_DIR.exists():
        print("未找到短期施工归档目录")
        return False

    cycle_dirs = sorted(ST_ARCHIVE_DIR.glob("第*期_*"))
    if target_cycle:
        cycle_dirs = [c for c in cycle_dirs if target_cycle in c.name]
        if not cycle_dirs:
            print(f"未找到匹配 '{target_cycle}' 的归档周期目录")
            return False

    print(f"🔄 启动归档库关键词全量重构与元数据提纯（共 {len(cycle_dirs)} 个周期, apply={apply}）...")

    updated_files_count = 0
    updated_catalog_count = 0
    file_keywords_map: dict[str, str] = {}  # archive_code -> new_keywords

    for c_dir in cycle_dirs:
        for vol_dir in sorted(c_dir.glob("Phase_*")):
            # 1. 提纯 ATT 附件关键词
            att_files = list(vol_dir.glob("*ATT*.md"))
            if att_files:
                att_file = att_files[0]
                m_att = re.search(r"(KALAR-DEV-\d{4}-ST\d{2}-ATT)", att_file.name)
                att_code = m_att.group(1) if m_att else ""
                st_id_m = re.search(r"-(ST\d{2})-", att_file.name)
                st_id = st_id_m.group(1) if st_id_m else "ST??"

                att_kws = extract_att_keywords(vol_dir, vol_dir.name, st_id)
                att_kw_str = "; ".join(att_kws)
                if att_code:
                    file_keywords_map[att_code] = att_kw_str

                if apply:
                    att_txt = att_file.read_text(encoding="utf-8")
                    new_att_txt = re.sub(r"(^主题词/关键词:\s*).*$", r"\g<1>" + att_kw_str, att_txt, flags=re.MULTILINE)
                    if new_att_txt != att_txt:
                        att_file.write_text(new_att_txt, encoding="utf-8", newline="\n")
                        updated_files_count += 1

            # 2. 提纯 4 个阶段正文文件的关键词
            stages = sorted([f for f in vol_dir.glob("*.md") if "阶段" in f.name and "ATT" not in f.name])
            for sf in stages:
                m_stage = re.search(r"(KALAR-DEV-\d{4}-ST\d{2}-\d{3})_阶段(\d)_(.+)\.md$", sf.name)
                if not m_stage:
                    continue
                stage_code = m_stage.group(1)
                stage_num = int(m_stage.group(2))
                stage_title = m_stage.group(3)

                kws = extract_stage_keywords(sf, vol_dir.name, stage_num, stage_title)
                kw_str = "; ".join(kws)
                file_keywords_map[stage_code] = kw_str

                if apply:
                    sf_txt = sf.read_text(encoding="utf-8")
                    new_sf_txt = re.sub(r"(^主题词/关键词:\s*).*$", r"\g<1>" + kw_str, sf_txt, flags=re.MULTILINE)
                    if new_sf_txt != sf_txt:
                        sf.write_text(new_sf_txt, encoding="utf-8", newline="\n")
                        updated_files_count += 1

    print(f"  ✅ 完成 {updated_files_count} 份归档文档 Frontmatter 主题词更新！")

    # 3. 同步更新 卡拉尔全宗档案总目录与元数据库.md
    if apply and MASTER_CATALOG.exists():
        cat_lines = MASTER_CATALOG.read_text(encoding="utf-8").splitlines()
        new_cat_lines = []
        for line in cat_lines:
            m = re.search(r"\|\s*`?(KALAR-DEV-\d{4}-ST\d{2}-[A-Z0-9]+)`?\s*\|", line)
            if m:
                code = m.group(1)
                if code in file_keywords_map:
                    cols = line.split("|")
                    if len(cols) >= 12:
                        cols[10] = f" {file_keywords_map[code]} "
                        line = "|".join(cols)
                        updated_catalog_count += 1
            new_cat_lines.append(line)

        MASTER_CATALOG.write_text("\n".join(new_cat_lines) + "\n", encoding="utf-8", newline="\n")
        print(f"  ✅ 完成 卡拉尔全宗档案总目录与元数据库.md 中 {updated_catalog_count} 行元数据关键词同步！")

    return True
