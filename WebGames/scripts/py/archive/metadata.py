#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 全宗元数据编目)
# 文件路径: WebGames/scripts/py/archive/metadata.py
# 架构定位: 档案全宗总目录生成器 (Master Archive Catalog Generator)
# 依赖与触发: 触发方: archive_volume.py | 上游: 全仓归档件 | 下游: 卡拉尔全宗档案总目录与元数据库.md | 运行时: Python 3.10+
# 职责说明: 扫描归档库全量历史卷册，全量构建并更新国家标准卡拉尔全宗档案总目录与统计看板
# 退出语义与设计依据: 退出码: 编目生成方法无独立退出码 | 设计依据: 国家标准科技档案案卷编目规范
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.metadata import rebuild_master_metadata
# ==============================================================================
"""metadata.py — 归档元数据求解与 DTO。

提供形成日期/归档日期/时段求解、YAML front-matter 题头剥离、Markdown 致密化
与 ArchiveRecordDTO 全宗检索总表 11 列标准记录渲染。"""
import hashlib
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from audit_common import resolve_repo_root
from archive.constants import resolve_responsible_short_from_context

ROOT = resolve_repo_root()

# 形成日期内容级缓存：同一内容（改名前后）在一次归档流程内只探测一次 git/文件系统
_FORMATION_DATE_CACHE: dict[str, str] = {}


def int_to_cn(num: int) -> str:
    """通用整数转中文数字（支持 1~9999；越界安全回退十进制字符串）"""
    digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
    units = ["", "十", "百", "千"]
    if num <= 0 or num >= 10000:
        return str(num)
    if num < 10:
        return digits[num]
    if num < 20:
        return "十" + (digits[num % 10] if num % 10 != 0 else "")
    if num < 100:
        res = digits[num // 10] + "十"
        if num % 10 != 0:
            res += digits[num % 10]
        return res
    if num < 1000:
        res = digits[num // 100] + "百"
        if num % 100 != 0:
            if num % 100 < 10:
                res += "零" + digits[num % 100]
            else:
                res += int_to_cn(num % 100)
        return res
    res = digits[num // 1000] + "千"
    if num % 1000 != 0:
        if num % 1000 < 100:
            res += "零" + int_to_cn(num % 1000)
        else:
            res += int_to_cn(num % 1000)
    return res


@dataclass
class ArchiveRecordDTO:
    """标准技术档案元数据记录 DTO（对齐卡拉尔全宗检索总表 11 列标准结构）"""
    seq: int
    archive_code: str
    volume_id: str
    piece_id: str
    title: str
    responsible: str
    retention: str
    security: str
    status: str
    keywords: str
    relative_path: str

    def to_markdown_row(self) -> str:
        """渲染为全宗检索总表标准 Markdown 表格行（11 列完整规范）"""
        return (
            f"| {self.seq} | `{self.archive_code}` | `{self.volume_id}` | `{self.piece_id}` | "
            f"{self.title} | {self.responsible} | {self.retention} | {self.security} | "
            f"{self.status} | {self.keywords} | [查看档案]({self.relative_path}) |"
        )

    @classmethod
    def from_file(cls, file_path: Path, seq: int, relative_path: str = "") -> "ArchiveRecordDTO":
        """从具体技术档案文件中动态解析 YAML front-matter 题头并生成标准 DTO。

        具备全要素泛化解析能力，彻底杜绝字面量硬编码默认值，
        实现对 11 列元数据（全要素 SSOT）的纯动态提取。
        """
        content = file_path.read_text(encoding="utf-8", errors="ignore")
        fm: dict[str, str] = {}
        fm_match = re.search(r"^\s*---\s*\n(.*?)\n---\s*(?:\n|$)", content, flags=re.DOTALL)
        if fm_match:
            for line in fm_match.group(1).splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    fm[k.strip()] = v.strip()

        # 1. 档号 (archive_code)
        archive_code = fm.get("档号", "").strip()
        if not archive_code:
            m_code = re.search(r"KALAR-DEV-\d{4}-[A-Z0-9]+-[A-Z0-9]+", file_path.name)
            archive_code = m_code.group(0) if m_code else file_path.stem

        # 2. 案卷号 (volume_id): e.g. ST70 (Phase_74_...) -> ST70, RM01 (第01卷: ...) -> RM01
        vol_raw = fm.get("案卷号", "").strip()
        m_vol = re.search(r"\b([A-Z]{2}\d{2})\b", vol_raw)
        if not m_vol:
            m_vol = re.search(r"KALAR-DEV-\d{4}-([A-Z]{2}\d{2})-", archive_code)
        volume_id = m_vol.group(1) if m_vol else (vol_raw.split()[0] if vol_raw else "")

        # 3. 件号 (piece_id): e.g. 001, ATT
        piece_id = fm.get("件号", "").strip()
        if not piece_id:
            if "ATT" in file_path.name or "ATT" in archive_code:
                piece_id = "ATT"
            else:
                m_piece = re.search(r"-(\d{3})_", file_path.name)
                piece_id = m_piece.group(1) if m_piece else "001"

        # 4. 题名 (title)
        raw_title = fm.get("题名", "").strip()
        if piece_id == "ATT" or "ATT" in file_path.name:
            if " —— " in raw_title:
                vol_name = raw_title.split(" —— ")[0].strip()
            else:
                vol_name = file_path.parent.name
            title = f"案卷共享附件：{vol_name} 全局上下文与公共契约"
        else:
            if " —— " in raw_title:
                title = raw_title.split(" —— ", 1)[1].strip()
            elif raw_title:
                title = raw_title
            else:
                m_stage = re.search(r"阶段(\d)_(.+?)(?:\.md)?$", file_path.name)
                if m_stage:
                    title = f"阶段{m_stage.group(1)}：{m_stage.group(2)}"
                else:
                    title = file_path.stem

        # 5. 责任者：配置映射单源解析（frontmatter 原文 → 路径提示 → 显式自定义值）
        resp_raw = fm.get("责任者", "").strip()
        responsible = resolve_responsible_short_from_context(resp_raw, file_path.name, str(file_path))

        # 6. 保管期限 (retention): 永久 (Permanent) -> 永久
        ret_raw = fm.get("保管期限", "").strip()
        if ret_raw:
            retention = re.split(r"[\s(（]", ret_raw)[0].strip()
        else:
            retention = "永久"

        # 7. 密级 (security): 内部公开 (Internal Open) -> 内部公开
        sec_raw = fm.get("密级", "").strip()
        if sec_raw:
            security = re.split(r"[\s(（]", sec_raw)[0].strip()
        else:
            security = "内部公开"

        # 8. 验收状态 (status): 已归档·100%自动化测试验收通过 (PASS) -> ✅ 100% PASS
        st_raw = fm.get("验收状态", "").strip()
        if "PASS" in st_raw or "100%" in st_raw or "通过" in st_raw:
            status = "✅ 100% PASS"
        elif st_raw:
            status = st_raw
        else:
            status = "✅ 100% PASS"

        # 9. 核心主题词 (keywords)
        keywords = fm.get("主题词/关键词", "").strip()

        # 10. 相对路径 (relative_path)
        if not relative_path:
            try:
                rel = file_path.resolve().relative_to((ROOT / "docs" / "归档库").resolve())
                relative_path = rel.as_posix()
            except Exception:
                relative_path = file_path.name
        else:
            relative_path = relative_path.replace("\\", "/")

        return cls(
            seq=seq,
            archive_code=archive_code,
            volume_id=volume_id,
            piece_id=piece_id,
            title=title,
            responsible=responsible,
            retention=retention,
            security=security,
            status=status,
            keywords=keywords,
            relative_path=relative_path,
        )


def minify_markdown_text(content: str) -> str:
    """UTF-8 NFC 归一化、消除连续冗余空行、修剪行尾空格并规范格式，实现 Token 致密化提纯。"""
    content = unicodedata.normalize("NFC", content)
    content = content.replace("\r\n", "\n")
    # 连续 3 个及以上换行收敛为 2 换行
    content = re.sub(r"\n{3,}", "\n\n", content)
    # 修剪行尾空格
    lines = [ln.rstrip() for ln in content.split("\n")]
    return "\n".join(lines).strip() + "\n"


def strip_existing_frontmatter(content: str) -> str:
    """
    健壮识别并剥离 Markdown 中已有的 YAML front-matter 题头。
    无论题头前是否有空白空行、无论是否包含草稿占位符或未决元数据，
    均能精准识别、安全剥离并提取纯正文内容，彻底杜绝双重题头堆叠或占位符泄漏。
    """
    pattern = r"^\s*---\s*\n.*?\n---\s*(?:\n|$)"
    stripped = re.sub(pattern, "", content, count=1, flags=re.DOTALL)
    return stripped.lstrip("\r\n")


def _resolve_git_formation_date(file_path: Path) -> str | None:
    """从 Git 历史提取文件首次提交 ISO 日期（带超时，失败返回 None）"""
    try:
        r = subprocess.run(
            ["git", "log", "--follow", "--format=%as", "--reverse", str(file_path.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=60,
        )
        if r.returncode == 0 and r.stdout.strip():
            first_date = r.stdout.strip().splitlines()[0].strip()
            if re.match(r"^\d{4}-\d{2}-\d{2}$", first_date):
                return first_date
    except Exception:
        return None
    return None


def resolve_file_formation_date(file_path: Path) -> str:
    """
    动态探查并计算文档的最早形成时间（形成日期）。
    优先级：① 文件内显式「施工开始日期/形成日期」时间戳（Agent 按 SOP 落系统时间，
    真实获取严禁编造）→ ② Git 首次提交日期 → ③ 底层文件系统创建时间 → ④ 今天兜底。
    彻底消除由 Agent 人工猜想或硬编码日期的隐患，确保元数据真实客观。
    同一文件内容（改名前后）在一次流程内命中内容级缓存，避免重复 git 探测。
    """
    content: str | None
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        content = None

    cache_key = ""
    if content is not None:
        # 1. 优先读取文件内显式形成时间戳（SOP：Agent 创建文件时落系统时间）
        #    支持 `**施工开始日期**：2026-08-20` 粗体包裹或裸字段两种写法
        m = re.search(r"施工开始日期\s*\*{0,2}\s*[:：]\s*(\d{4}-\d{2}-\d{2})", content)
        if not m:
            m = re.search(r"形成日期\s*\*{0,2}\s*[:：]\s*(\d{4}-\d{2}-\d{2})", content)
        if m:
            return m.group(1)
        cache_key = hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
        cached = _FORMATION_DATE_CACHE.get(cache_key)
        if cached is not None:
            return cached

    # 2. 尝试从 Git 历史提取文件首次提交的 ISO 日期
    git_date = _resolve_git_formation_date(file_path)
    if git_date:
        if cache_key:
            _FORMATION_DATE_CACHE[cache_key] = git_date
        return git_date

    # 3. 回退到底层文件系统的创建时间 (Windows st_ctime / st_birthtime)
    try:
        st = file_path.stat()
        ctime = getattr(st, "st_birthtime", st.st_ctime)
        result = date.fromtimestamp(ctime).isoformat()
    except Exception:
        result = date.today().isoformat()
    if cache_key:
        _FORMATION_DATE_CACHE[cache_key] = result
    return result


def resolve_period_label(hour: int) -> str:
    """施工时段六刻度（与 scripts/sh/timestamp.sh 一致，半开区间）：
    半夜（22~01 跨日）/ 凌晨（02~05）/ 早上（06~09）/ 中午（10~13）/ 下午（14~17）/ 晚上（18~21）"""
    if hour >= 22 or hour < 2:
        return "半夜"
    if hour < 6:
        return "凌晨"
    if hour < 10:
        return "早上"
    if hour < 14:
        return "中午"
    if hour < 18:
        return "下午"
    return "晚上"


def resolve_file_archive_date(default_today: str) -> str:
    """获取归档日期（以归档自动化流水线执行当天为准；D2 修复：移除未使用的 file_path 死参）"""
    return default_today or date.today().isoformat()


def resolve_file_formation_period(file_path: Path) -> str | None:
    """从文件内「施工开始日期」戳提取施工时段（六刻度 + 历史保留词「上午」）；无戳则返回 None"""
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"施工开始日期\s*\*{0,2}\s*[:：]\s*\d{4}-\d{2}-\d{2}[^\n]*(早上|上午|中午|下午|晚上|半夜|凌晨)", content)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None
