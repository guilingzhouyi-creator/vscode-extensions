#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档质量门禁)
# 文件路径: WebGames/scripts/py/audit_docs.py
# 架构定位: 综合文档审查引擎 (Document Audit Engine)
# 依赖与触发: 触发方: CI / audit-all / 本地 CLI | 上游: docs/**/*.md | 下游: 门禁报告与自动修复 | 运行时: Python 3.10+
# 职责说明: 递归审查全仓文档命名规范、目录布局、内链有效性、时间戳纪律与四阶段施工细则结构
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规, 2=用法错误 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_docs.py
#   python scripts/py/audit_docs.py --json
#   python scripts/py/audit_docs.py --fix
# ==============================================================================
"""docs/ 文档库静态审查：命名格式、文档布局、链接完整性、mermaid 图表健康度。"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from audit_common import KALAR_DEV_PREFIX, ensure_utf8_stdout, resolve_repo_root

ROOT = resolve_repo_root()          # WebGames 仓库根
DOCS_DIR = "docs"

SEV_ERROR = "error"
SEV_WARN = "warn"

# ------------------------------------------------------------------------------
# 规则注册表（唯一真源 scripts/config/docs_governance_rules.json）。
# 稳定 ID → (级别, 是否可自动修复, 说明)；新增规则改 JSON 即可，代码零改动。
# ------------------------------------------------------------------------------
DOC_RULES_FILE = ROOT / "scripts" / "config" / "docs_governance_rules.json"


def _load_doc_rules() -> tuple:
    """加载文档治理规则真源（RULES + NAMING_RULES）。
    JSON 缺失/解析失败 → 打印错误并以退出码 2 阻断（配置即门禁，禁止静默降级回退硬编码）。"""
    if not DOC_RULES_FILE.exists():
        print(f"[ERROR] 文档治理规则真源缺失: {DOC_RULES_FILE}（新增规则请改 JSON）", file=sys.stderr)
        sys.exit(2)
    try:
        data = json.loads(DOC_RULES_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[ERROR] 文档治理规则真源解析失败 {DOC_RULES_FILE}: {e}", file=sys.stderr)
        sys.exit(2)

    rules: dict = {}
    for rid, meta in (data.get("rules", {}) or {}).items():
        sev = SEV_ERROR if str(meta.get("severity", "error")) == "error" else SEV_WARN
        rules[str(rid)] = (sev, bool(meta.get("fixable", False)), str(meta.get("desc", "")))
    return rules, data.get("naming_rules", []) or []

# ---------------------------------------------------------------------------
# 命名规范声明：scope=相对 docs/ 的父目录，约束其直接子项；sub=True 约束全部层级
# （排除 scope 直属子项）。未声明 scope 不 gate。真源见 docs_governance_rules.json。
# ---------------------------------------------------------------------------
RULES, NAMING_RULES = _load_doc_rules()

CN_NUMERALS = "一二三四五六七八九十"

FENCE_RE = re.compile(r"^(\s*)```(\w*)")
TABLE_ROW_RE = re.compile(r"^\s*\|")   # GFM 行首竖线即表格行（行尾竖线可省略）
WS_TAIL_RE = re.compile(r"[ \t]+$")
BR_TAG_RE = re.compile(r"<br>")
HEADING_PLAIN_RE = re.compile(r"^#{1,6}\s+(.*)$")
HEADING_NOSPACE_RE = re.compile(r"^(#{1,6})([^#\s].*)$")
ABSLINK_RE = re.compile(r"\]\(\s*file:///[^)\s]+\s*\)")
RELLINK_RE = re.compile(r"\]\(([^)\s]+)\)")
NODE_RE = re.compile(r"([\w\u4e00-\u9fff])\s*([\[\(\{])")
MERMAID_SKIP_RE = re.compile(
    r"^\s*(%%|subgraph\b|end\s*$|classDef\b|class\s|style\s|linkStyle\b|direction\b|"
    r"graph\s|flowchart\s|sequenceDiagram|stateDiagram|erDiagram|gantt|pie\b)")
SHAPE_CLOSE = {"[": "]", "(": ")", "{": "}"}
SPECIAL_CHARS = set("[]{}()")
LIST_PREFIX_RE = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s)")


def slugify(text: str) -> str:
    """GitHub 风格标题锚 slug：小写、去标点、空格转 -，保留 CJK。"""
    t = text.strip().lower()
    t = re.sub(r"[^\w\u4e00-\u9fff\- ]", "", t)
    return t.replace(" ", "-")


@dataclass
class Finding:
    rule: str
    file: str            # 相对 WebGames 根的 posix 路径
    line: int = 0        # 1-based；目录级发现为 0
    message: str = ""
    suggestion: str = ""  # Agent 决策辅助：建议名 / 候选锚点 / 修复预览
    extra: dict = field(default_factory=dict)
    is_new: bool = False  # 基线棘轮模式下：True=超出基线的新增违规（阻断门禁）

    def to_dict(self) -> dict:
        d = {"rule": self.rule, "severity": RULES[self.rule][0], "file": self.file,
             "line": self.line, "message": self.message,
             "fixable": RULES[self.rule][1], "new": self.is_new}
        if self.suggestion:
            d["suggestion"] = self.suggestion
        if self.extra:
            d["extra"] = self.extra
        return d


@dataclass
class Doc:
    path: Path
    rel: str
    text: str
    eol: str
    lines: list
    inside: list          # 每行是否处于代码围栏内
    heading_slugs: set = field(default_factory=set)
    has_mermaid: bool = False   # 装载期预判，审查期快速跳过非图表文件


def split_fences(lines: list) -> list:
    """标记每行是否处于围栏内（成对切换；奇数围栏 → 末行 inside=True，供审查）。"""
    inside, state = [], False
    for ln in lines:
        inside.append(state)
        if FENCE_RE.match(ln):
            state = not state
    return inside


def scan_mermaid_line(ln: str) -> list:
    """扫描一行 mermaid 节点定义。

    返回 [(open_col, open_ch, content, end_col)]：内容未整体加引号且含 [ ] { } ( ) 的形状。
    形状识别：ID 后跟 [ ( {，同型括号深度配对取内容（本库无 [( )]/([ ]) 复合形状，已核查）。
    """
    hits, pos = [], 0
    while True:
        m = NODE_RE.search(ln, pos)
        if not m:
            return hits
        open_ch = m.group(2)
        close_ch = SHAPE_CLOSE[open_ch]
        depth, j = 1, m.end()
        while j < len(ln) and depth:
            if ln[j] == open_ch:
                depth += 1
            elif ln[j] == close_ch:
                depth -= 1
            j += 1
        if depth:                        # 本行括号未闭合：交给人工，不在此误报
            return hits
        content = ln[m.end():j - 1]
        if not (content.startswith('"') and content.endswith('"') and len(content) >= 2):
            if any(c in SPECIAL_CHARS for c in content):
                hits.append((m.start(2), open_ch, content, j))
        pos = j


def mermaid_fix_line(ln: str) -> str:
    """返回 (新行, 修复数)：对命中形状的内容整体加双引号（内容含引号则跳过留人工）。"""
    hits = scan_mermaid_line(ln)
    if not hits:
        return ln, 0
    out, pos, n = [], 0, 0
    for col, open_ch, content, end in hits:
        if '"' in content:
            continue
        out.append(ln[pos:col])
        out.append(open_ch + '"' + content + '"' + SHAPE_CLOSE[open_ch])
        pos = end
        n += 1
    out.append(ln[pos:])
    return "".join(out), n


class DocsAuditor:
    def __init__(self, root: Path, docs_dir: str = DOCS_DIR, naming: Any = None,
                 extra_files: Any = None) -> None:
        self.root = root
        self.docs = root / docs_dir
        self.naming = naming if naming is not None else NAMING_RULES
        self.docs_map: dict = {}       # str(绝对路径) -> Doc
        self.decode_errors: dict = {}
        self.dir_index: dict = {}      # str(目录绝对路径) -> [子项绝对路径]（单趟 walk，命名域复用）
        self.extra_files = [Path(p) for p in (extra_files or [])]  # docs/ 之外的门禁覆盖件（如根 README）

    # ---------- 装载：单趟 os.walk 同时建目录索引（命名域零额外遍历） ----------
    def load(self) -> None:
        self.docs_map.clear()
        self.decode_errors.clear()
        self.dir_index.clear()
        if self.docs.is_dir():
            for dirpath, dirnames, filenames in os.walk(self.docs):
                dp = Path(dirpath)
                self.dir_index[str(dp)] = [dp / d for d in sorted(dirnames)] \
                    + [dp / f for f in sorted(filenames)]
                for f in filenames:
                    if f.endswith(".md"):
                        self._load_one(dp / f)
        for p in self.extra_files:      # 入口级文档（根 README）同样受四域门禁约束
            if p.is_file():
                self._load_one(p)

    def _load_one(self, p: Path) -> None:
        try:
            raw = p.read_bytes().decode("utf-8")
        except (UnicodeDecodeError, OSError) as e:
            self.decode_errors[str(p)] = str(e)
            return
        eol = "\r\n" if "\r\n" in raw else "\n"
        text = raw.replace("\r\n", "\n")
        lines = text.split("\n")
        inside = split_fences(lines)
        slugs, has_mermaid = set(), False
        state = False
        for ln in lines:                       # 单趟完成：围栏态 + 标题索引 + mermaid 预判
            m = FENCE_RE.match(ln)
            if m:
                if not state and m.group(2).lower() == "mermaid":
                    has_mermaid = True
                state = not state
                continue
            if not state:
                hm = HEADING_PLAIN_RE.match(ln)
                if hm:
                    slugs.add(slugify(hm.group(1)))
        self.docs_map[str(p)] = Doc(p, self._rel(p), text, eol, lines, inside, slugs, has_mermaid)

    def _rel(self, p: Path) -> str:
        try:
            return p.relative_to(self.root).as_posix()
        except ValueError:
            return p.as_posix()

    # ---------- 审查 ----------
    def check(self) -> list:
        findings: list = []
        self._transient: dict = {}   # 按需加载的锚点目标（不并入正式审计集合）
        for doc in list(self.docs_map.values()):
            self._check_layout(doc, findings)
            self._check_mermaid(doc, findings)
            self._check_links(doc, findings)
        self._check_naming(findings)
        self._check_formation_date(findings)
        self._check_phase_governance(findings)
        findings.sort(key=lambda f: (f.file, f.line, f.rule))
        return findings

    def _get_doc(self, p: Path) -> Any:
        """取链接目标文档；不在审计集合内则按需载入临时缓存（仅作锚点索引）。"""
        key = str(p)
        if key in self.docs_map:
            return self.docs_map[key]
        if key not in self._transient:
            self._transient[key] = None
            if p.exists() and p.suffix == ".md":
                try:
                    raw = p.read_bytes().decode("utf-8")
                except (UnicodeDecodeError, OSError):
                    return None
                lines = raw.replace("\r\n", "\n").split("\n")
                inside = split_fences(lines)
                slugs = {slugify(m.group(1)) for ln, ins in zip(lines, inside)
                         if not ins and (m := HEADING_PLAIN_RE.match(ln))}
                self._transient[key] = Doc(p, self._rel(p), raw, "\n", lines, inside, slugs)
        return self._transient[key]

    def _add(self, out: list, doc: Any, rule: str, line: int, message: str, suggestion: str = "", extra: Any = None) -> None:
        out.append(Finding(rule, doc.rel, line, message, suggestion, extra or {}))

    def _check_layout(self, doc: Doc, out: list) -> None:
        if doc.rel == "" and doc.text == "":
            return
        if str(doc.path) in self.decode_errors:
            self._add(out, doc, "LAYOUT-FENCE-UNCLOSED", 0,
                      f"文件解码失败，无法审查: {self.decode_errors[str(doc.path)]}")
            return
        h1 = [i + 1 for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside))
              if not ins and re.match(r"^#(\s|$)", ln)]
        if len(h1) > 1:
            self._add(out, doc, "LAYOUT-H1-MULTI", h1[0],
                      f"发现 {len(h1)} 个一级标题（行 {h1[:5]}{'…' if len(h1) > 5 else ''}），应合并为单一 H1")
        elif not h1 and any(ln.strip() for ln in doc.lines):
            self._add(out, doc, "LAYOUT-H1-ABSENT", 0, "全文无一级标题")
        if doc.inside and doc.inside[-1]:
            self._add(out, doc, "LAYOUT-FENCE-UNCLOSED", len(doc.lines), "文件结尾处存在未闭合代码围栏")

        # 四段式结构标准（仅约束后端需求表：一实体/二求解/三状态机/四验收，对应路线图 4 大标准阶段）
        if re.fullmatch(r"后端架构需求表\d+\.md", os.path.basename(str(doc.path))):
            h2 = [ln for ln, ins in zip(doc.lines, doc.inside) if not ins and ln.startswith("## ")]
            have = {ln[3].strip() for ln in h2 if len(ln) > 3}
            missing = [n for n in "一二三四" if n not in have]
            if missing:
                self._add(out, doc, "LAYOUT-SECTION-STD", 0,
                          "缺少标准章节: " + " ".join("## " + n + "、" for n in missing)
                          + "（补齐后归档阶段3/4 真理指针方可指向真实章节）")

        # 归档件头块标准：归档库阶段件前 20 行须含 档号: 与 验收状态（两态生命周期归档时补齐）
        rel_posix = doc.rel
        if "归档库/" in rel_posix and re.search(KALAR_DEV_PREFIX + r"-(RM|FE)\d{2}-\d{3}_阶段\d_", rel_posix):
            head = "\n".join(doc.lines[:20])
            lack = [k for k in ("档号:", "验收状态") if k not in head]
            if lack:
                self._add(out, doc, "LAYOUT-ARCHIVE-HEAD", 0,
                          f"归档件缺档案头块字段: {' / '.join(lack)}"
                          "（归档时须补 档号/题名/验收状态/主题词 等键值头）")

        # 表格连续块：列数一致性 + 表前空行
        rows = [i for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside))
                if not ins and TABLE_ROW_RE.match(ln)]
        blocks = []
        for r in rows:
            if blocks and r == blocks[-1][-1] + 1:
                blocks[-1].append(r)
            else:
                blocks.append([r])
        for blk in blocks:
            if len(blk) == 1:
                self._add(out, doc, "LAYOUT-TABLE-COLS", blk[0] + 1, "孤立表格行（缺表头/分隔行）")
                continue

            def ncols(ln: str) -> int:
                """单元格数 = 去首尾竖线后剩余未转义竖线数 + 1（兼容省略行尾竖线的行）。"""
                s = re.sub(r"\\\|", "\x00", ln.strip())
                if s.startswith("|"):
                    s = s[1:]
                if s.endswith("|"):
                    s = s[:-1]
                return s.count("|") + 1
            head = ncols(doc.lines[blk[0]])
            for r in blk:
                c = ncols(doc.lines[r])
                if c != head:
                    self._add(out, doc, "LAYOUT-TABLE-COLS", r + 1, f"表格行 {c} 列，表头 {head} 列")
            r0 = blk[0]
            if r0 > 0:
                prev = doc.lines[r0 - 1]
                if prev.strip() and not doc.inside[r0 - 1] \
                        and not prev.lstrip().startswith(("#", ">", "|")) \
                        and not LIST_PREFIX_RE.match(prev) and not FENCE_RE.match(prev):
                    self._add(out, doc, "LAYOUT-TABLE-GAP", r0 + 1,
                              "表格前一行是段落文本，缺空行分隔（GFM 会并入段落）", "在该表格前插入一个空行")

    def _check_mermaid(self, doc: Doc, out: list) -> None:
        if not doc.has_mermaid:                # 装载期预判：非图表文件零扫描
            return
        in_mermaid = False
        for i, ln in enumerate(doc.lines, 1):
            if FENCE_RE.match(ln):
                lang = FENCE_RE.match(ln).group(2).lower()
                in_mermaid = (lang == "mermaid") if not in_mermaid else False
                continue
            if not in_mermaid or MERMAID_SKIP_RE.match(ln):
                continue
            for col, open_ch, content, _end in scan_mermaid_line(ln):
                self._add(out, doc, "MERMAID-SPECIAL-CHARS", i,
                          f"节点标签含未加引号的特殊字符（{open_ch}…）",
                          f'{open_ch}"{content}"' + SHAPE_CLOSE[open_ch],
                          {"content": content[:80]})

    def _check_links(self, doc: Doc, out: list) -> None:
        for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside), 1):
            if ins:
                continue
            if doc.rel.startswith("docs/模板/"):
                continue  # 模板目录的占位链接（<相对路径>/NN）不做死链判定
            for m in ABSLINK_RE.finditer(ln):
                frag, _, anchor = m.group()[2:-1].strip().partition("#")
                target = self._abs_target(frag)
                if not target:
                    self._add(out, doc, "LINK-DEAD", i,
                              f"file:/// 链接目标不存在: {urllib.parse.unquote(frag)[:90]}")
                    continue
                self._add(out, doc, "LINK-ABS-FILE-URI", i,
                          "file:/// 绝对路径链接（目标可解析，可安全转相对链接）",
                          suggestion=target)
                tpath = Path(target)
                if anchor and tpath.suffix == ".md":
                    tdoc = self._get_doc(tpath)
                    if tdoc is not None:
                        slug = slugify(urllib.parse.unquote(anchor))
                        if slug not in tdoc.heading_slugs:
                            tail = slug.rsplit("-", 1)[-1]
                            cands = [s for s in tdoc.heading_slugs if s.rsplit("-", 1)[-1] == tail][:3]
                            self._add(out, doc, "LINK-ANCHOR-DEAD", i,
                                      f'锚点失效: #{urllib.parse.unquote(anchor)[:60]}（目标 {tpath.name}）',
                                      "候选: " + " | ".join(cands) if cands else "无相近候选，需人工核对目标章节")
            for m in RELLINK_RE.finditer(ln):
                t = m.group(1)
                if t.startswith(("http://", "https://", "file:///")):
                    continue
                frag, _, anchor = t.partition("#")
                frag_norm = urllib.parse.unquote(frag).replace('\\', '/')
                dest = doc.path.parent / frag_norm
                dest_key = str(dest)
                if dest_key not in self.docs_map and not dest.exists():
                    self._add(out, doc, "LINK-DEAD", i, f"相对链接目标不存在: {frag}")
                    continue
                if not anchor or dest.suffix != ".md":
                    continue
                target_doc = self._get_doc(dest)
                if target_doc is None:
                    continue
                slug = slugify(urllib.parse.unquote(anchor))
                if slug not in target_doc.heading_slugs:
                    tail = slug.rsplit("-", 1)[-1]
                    cands = [s for s in target_doc.heading_slugs if s.rsplit("-", 1)[-1] == tail][:3]
                    self._add(out, doc, "LINK-ANCHOR-DEAD", i,
                              f'锚点失效: #{urllib.parse.unquote(anchor)[:60]}（目标 {self._rel(dest)}）',
                              "候选: " + " | ".join(cands) if cands else "无相近候选，需人工核对目标章节")

    def _abs_target(self, frag: str) -> str:
        """file:///c:/…/docs/<rest> → 仓库内目标路径；不可解析返回 ''。"""
        frag_u = urllib.parse.unquote(frag)
        m = re.search(r"/docs/(.+)$|/docs$", frag_u)
        if not m:
            return ""
        rest = m.group(1) or ""
        cand = self.docs.joinpath(*rest.split("/")) if rest else self.docs
        return str(cand) if cand.exists() else ""

    # ---------- 命名域 ----------
    def _check_formation_date(self, out: list) -> None:
        """开发期施工细则须含「施工开始日期」时间戳（SOP 落戳约定；归档件由 14 项头块承载）。"""
        active_dir = self.docs / "路线图" / "01_短期施工区"
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
                        "DATE-STAMP", self._rel(sf), 1,
                        "开发期施工细则缺少「施工开始日期」时间戳",
                        "请按 SOP 走一步获取系统时间（如 date +%F），在正文题头落「施工开始日期: YYYY-MM-DD」"))

    def _check_phase_governance(self, out: list) -> None:
        """短期施工区与路线图全域治理门禁：
        1. 案卷目录物理边界（PHASE-VOLUME-STRUCTURE）：每个案卷内必须且仅允许包含 4 份分阶段施工细则（阶段1~4），严禁自造 README.md、子目录或多余文件；
        2. 制度文档防污染（ROADMAP-README-POLLUTION）：01_短期施工区/README.md 仅作为施工区制度说明规范，严禁向其写入在途案卷或任务列表；
        3. 路线图登记唯一真源（ROADMAP-INDEX-MISSING）：全域在途案卷必须且仅在 docs/路线图/路线图总索引.md 中登记；
        4. 序号连续性与唯一性（NAMING-DIR / NAMING-SEQ）：序号严格递增无跳号无重复。
        """
        active_dir = self.docs / "路线图" / "01_短期施工区"
        if not active_dir.is_dir():
            return

        # 1. 检查 01_短期施工区/README.md 纯净度
        st_readme = active_dir / "README.md"
        if st_readme.is_file():
            content = st_readme.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"##\s*.*在途案卷", content) or re.search(r"\[Phase_\d+[^\]]*\]\(Phase_\d+", content):
                out.append(Finding(
                    "ROADMAP-README-POLLUTION", self._rel(st_readme), 1,
                    "docs/路线图/01_短期施工区/README.md 被污染写入了在途案卷或任务列表！该文件仅作为短期施工区制度说明规范，路线图登记唯一真源为 docs/路线图/路线图总索引.md",
                    "请清理 01_短期施工区/README.md 中的在途案卷列表与链接，保持纯净制度说明"
                ))

        # 读取路线图总索引内容
        roadmap_index = self.docs / "路线图" / "路线图总索引.md"
        roadmap_index_text = roadmap_index.read_text(encoding="utf-8", errors="ignore") if roadmap_index.is_file() else ""

        phase_dirs = [p for p in active_dir.iterdir() if p.is_dir() and p.name.startswith("Phase_")]
        seen_numbers = {}

        for p in phase_dirs:
            m = re.match(r"^Phase_(\d+)_", p.name)
            if not m:
                out.append(Finding(
                    "NAMING-DIR", self._rel(p), 0,
                    f"短期施工区目录命名不符合 Phase_NN_前缀规范: {p.name}",
                    "请使用 Phase_NN_主题名称 格式"
                ))
                continue
            num = int(m.group(1))
            if num in seen_numbers:
                out.append(Finding(
                    "NAMING-DIR", self._rel(p), 0,
                    f"短期施工区存在重复 Phase 序号 [{num}]: 与 {self._rel(seen_numbers[num])} 冲突",
                    "请修正为序列中的下一个合法连续序号"
                ))
            else:
                seen_numbers[num] = p

            # 2. 案卷文件结构铁律检查（严禁自造 README.md、子目录或多余文件）
            sub_entries = list(p.iterdir())
            has_readme = any(f.name.lower() == "readme.md" for f in sub_entries)
            if has_readme:
                out.append(Finding(
                    "PHASE-VOLUME-STRUCTURE", self._rel(p / "README.md"), 1,
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
                    "PHASE-VOLUME-STRUCTURE", self._rel(p), 0,
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
                self._check_phase_stage_file(sf, out)
            missing_stages = set([1, 2, 3, 4]) - found_stages
            if missing_stages:
                out.append(Finding(
                    "PHASE-VOLUME-STRUCTURE", self._rel(p), 0,
                    f"案卷目录「{p.name}」缺少阶段细则: {missing_stages}（每个案卷必须且仅允许包含阶段1~4共4份文件）",
                    "请按四阶段模板补充齐备"
                ))

            # 4. 路线图总索引唯一真源登记检查
            if roadmap_index_text:
                phase_pattern = rf"\bPhase[_\s]{num}\b"
                if not re.search(phase_pattern, roadmap_index_text):
                    out.append(Finding(
                        "ROADMAP-INDEX-MISSING", self._rel(p), 0,
                        f"在途案卷「{p.name}」(Phase {num}) 未在 docs/路线图/路线图总索引.md 中登记！总索引为全域路线图唯一真源",
                        f"请在 docs/路线图/路线图总索引.md 登记「Phase {num}: ...」四阶段细则直达与状态表格"
                    ))

        # 5. 检查连续性无跳号
        if seen_numbers:
            nums = sorted(seen_numbers.keys())
            for i in range(len(nums) - 1):
                if nums[i+1] != nums[i] + 1:
                    out.append(Finding(
                        "NAMING-SEQ", self._rel(seen_numbers[nums[i+1]]), 0,
                        f"短期施工区 Phase 序号存在跳号/断号: 从 Phase_{nums[i]:02d} 跳至 Phase_{nums[i+1]:02d}",
                        "短期施工区必须保持严格递增连续且无跳号"
                    ))

        # 6. 施工区周期积累过量预警 (ROADMAP-CYCLE-OVERDUE)
        if len(phase_dirs) >= 10:
            out.append(Finding(
                "ROADMAP-CYCLE-OVERDUE", self._rel(active_dir), 0,
                f"短期施工区在途案卷当前累积已达 {len(phase_dirs)}/10 卷，已达到或超出 10 卷归档周期阈值！",
                "请按归档周期机制执行 python scripts/py/archive_volume.py --cycle --apply 进行周期归档封存，严禁无限制堆积在途案卷"
            ))

    def _check_phase_stage_file(self, sf_path: Path, out: list) -> None:
        """短期施工区阶段施工细则四段式正文深度规范审查：
        1. PHASE-TITLE-FORMAT: 一级标题格式必须为「# 施工细则：<案卷主题> —— 阶段<N>：<阶段主题>」
        2. PHASE-STAGE-STD: 必须包含四段式核心标准结构：
           - 头部 [!NOTE] 目标题头（前 35 行须含【施工目标】）
           - ## 📌 第一性原理溯源指针（含精准上游规范指针、核心不变量约束断言、最高指示）
           - ## 二、 命令式施工执行清单 (Agent Execution Checklist)（含复选框）
           - ## 三、 ...验收矩阵 (DoD Matrix)（含标准表头「检验项 ID」与「预期输出断言」）
        3. PHASE-CODE-SANITY: 代码块不得散落 push_error/push_warning 或 randf/randi
        """
        doc = self.docs_map.get(str(sf_path))
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
                    "根据 Phase 66 统一收敛规范，细则示例代码严禁散落 push_error/push_warning，应使用 printerr 或 ErrorReporter"
                ))
            if re.search(r"\b(randf|randf_range|randi|randi_range|randomize)\s*\(", s):
                out.append(Finding(
                    "PHASE-CODE-SANITY", rel, i + 1,
                    f"细则代码块违规包含非确定性随机调用: {s[:60]}",
                    "根据 ADV-RNG-001 规范，细则示例代码严禁调用全局 randf/randi，应使用确定性伪随机/LCG 计算"
                ))

    def _check_naming(self, out: list) -> None:
        if not self.docs.is_dir():
            return
        for rule in self.naming:
            scope = self.docs if rule["scope"] == "." else self.docs / rule["scope"]
            entries = self.dir_index.get(str(scope))
            if entries is None:
                continue
            if rule.get("sub"):                        # 递归约束 scope 深层全部文件
                scope_prefix = str(scope) + os.sep
                for d, descs in self.dir_index.items():
                    if not d.startswith(scope_prefix):
                        continue
                    for p in descs:
                        if p.is_file() and p.parent != scope and rule.get("files") \
                                and not any(re.fullmatch(pat, p.name) for pat in rule["files"]):
                            out.append(Finding("NAMING-FILE", self._rel(p), 0,
                                               f'文件名「{p.name}」不符合 scope「{rule["scope"]}」声明模式'))
                continue
            for p in entries:
                rel = self._rel(p)
                if p.is_dir() and rule.get("dirs"):
                    if not any(re.fullmatch(pat, p.name) for pat in rule["dirs"]):
                        out.append(Finding("NAMING-DIR", rel, 0,
                                           f'目录名「{p.name}」不符合 scope「{rule["scope"]}」声明模式'))
                elif p.is_file() and rule.get("files"):
                    if not any(re.fullmatch(pat, p.name) for pat in rule["files"]):
                        out.append(Finding("NAMING-FILE", rel, 0,
                                           f'文件名「{p.name}」不符合 scope「{rule["scope"]}」声明模式'))
        self._check_seq(out)

    def _check_seq(self, out: list) -> None:
        """同前缀文件族混用「无编号」与「中文数字编号」→ 建议补齐最小缺失序号。"""
        by_dir: dict = {}
        for doc in self.docs_map.values():             # 复用已装载集合，零额外遍历
            by_dir.setdefault(doc.path.parent, []).append(doc.path)
        for d, files in by_dir.items():
            fam: dict = {}
            for p in files:
                m = re.match(r"^(.+?)([一二三四五六七八九十])?\.md$", p.name)
                if m and len(m.group(1)) >= 4:
                    fam.setdefault(m.group(1), []).append(m.group(2) or "")
            for prefix, nums in fam.items():
                if len(nums) < 2 or "" not in nums:
                    continue
                used = sorted(n for n in nums if n)
                missing = next((c for c in CN_NUMERALS if c not in used), "")
                if missing:
                    out.append(Finding("NAMING-SEQ", self._rel(d / (prefix + ".md")), 0,
                                       f'文件族「{prefix}*」混用无编号与中文编号成员（已有: {"".join(used)}）',
                                       f"重命名 {prefix}.md → {prefix}{missing}.md 并同步全库入链"))

    # ---------- 修复域（仅安全六类） ----------
    def fix(self, dry_run: bool = False) -> tuple:
        """应用安全修复。返回 (applied 列表, 修复后残留 findings)。

        演练模式：内存态临时应用以便复检，校验后回滚，磁盘零写入；正式模式才写盘。
        """
        applied, changed = [], []
        for doc in self.docs_map.values():
            new_lines, n_fix = [], 0
            in_mermaid = False
            for ln in doc.lines:
                if FENCE_RE.match(ln):
                    lang = FENCE_RE.match(ln).group(2).lower()
                    in_mermaid = (lang == "mermaid") if not in_mermaid else False
                    new_lines.append(ln)
                    continue
                cur = ln
                if in_mermaid:
                    cur, n = mermaid_fix_line(cur)
                    n_fix += n
                else:
                    if WS_TAIL_RE.search(cur):
                        cur = WS_TAIL_RE.sub("", cur)
                        n_fix += 1
                    n_br = len(BR_TAG_RE.findall(cur))
                    if n_br:
                        cur = BR_TAG_RE.sub("<br/>", cur)
                        n_fix += n_br
                    hm = HEADING_NOSPACE_RE.match(cur)
                    if hm:
                        cur = hm.group(1) + " " + hm.group(2)
                        n_fix += 1
                    if TABLE_ROW_RE.match(cur) and new_lines and new_lines[-1].strip() \
                            and not new_lines[-1].lstrip().startswith(("#", ">", "|")) \
                            and not LIST_PREFIX_RE.match(new_lines[-1]) \
                            and not FENCE_RE.match(new_lines[-1]) \
                            and not TABLE_ROW_RE.match(new_lines[-1]):
                        new_lines.append("")
                        n_fix += 1
                new_lines.append(cur)
            new_text, n_abs = self._fix_abs_links("\n".join(new_lines), doc.path)
            n_fix += n_abs
            if n_fix and new_text != doc.text:
                applied.append({"file": doc.rel, "fixes": n_fix})
                changed.append((doc, doc.text, doc.lines, doc.inside, new_text))
                doc.text, doc.lines = new_text, new_text.split("\n")
                doc.inside = split_fences(doc.lines)
        residual = self.check()
        if dry_run:
            for doc, ot, ol, oi, _nt in changed:
                doc.text, doc.lines, doc.inside = ot, ol, oi
        else:
            for doc, _ot, _ol, _oi, nt in changed:
                doc.path.write_bytes(nt.replace("\n", doc.eol).encode("utf-8"))
        return applied, residual

    def _fix_abs_links(self, text: str, src: Path) -> str:
        n = 0

        def repl(m: Any) -> str:
            nonlocal n
            inner = m.group()[2:-1].strip()
            frag, _, anchor = inner.partition("#")
            target = self._abs_target(frag)
            if not target:
                return m.group()
            rel = os.path.relpath(Path(target), src.parent).replace("\\", "/")
            n += 1
            return "](" + rel + (("#" + anchor) if anchor else "") + ")"

        return ABSLINK_RE.sub(repl, text), n


# ---------------------------------------------------------------------------
# 自测：内建夹具覆盖全部规则类（临时目录内进行，不触碰真实 docs）
# ---------------------------------------------------------------------------
def cmd_self_test() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="docs_audit_selftest_"))
    fails = []
    try:
        docs = tmp / "docs"
        (docs / "域A").mkdir(parents=True)
        (docs / "域A" / "表1.md").write_text(
            "# 标题\n\n正文段落\n| a | b |\n| - | - |\n| 1 | 2 |\n", encoding="utf-8")
        (docs / "域A" / "后端架构需求表99.md").write_text(
            "# 后端架构需求表99（第99卷：自测）\n\n## 一、 实体\n\n## 二、 求解器\n", encoding="utf-8")
        (docs / "域A" / "坏名.md").write_text("# x\n", encoding="utf-8")
        (docs / "域A" / "玩法设计稿.md").write_text("# x\n", encoding="utf-8")
        (docs / "域A" / "玩法设计稿二.md").write_text("# x\n", encoding="utf-8")
        (docs / "域A" / "链接.md").write_text(
            "# L\n\n[死链](./不存在.md) [绝对](file:///c:/no/such/docs/域A/表1.md) "
            "[死锚](表1.md#无此节) [绝对死](file:///c:/no/such/docs/域A/没了.md) "
            "[绝对死锚](file:///c:/no/such/docs/域A/表1.md#也不存在)\n", encoding="utf-8")
        (docs / "域A" / "图.md").write_text(
            "# G\n\n```mermaid\ngraph TD\n    A[矮人大陆 (Kalar)] --> B[快照 alias_slots[]]\n"
            '    C["已引号 (ok)"] --> D{普通}\n```\n', encoding="utf-8")
        arch = docs / "归档库" / "01_施工路线图档案卷" / "卷01_测试卷"
        arch.mkdir(parents=True, exist_ok=True)
        (arch / (KALAR_DEV_PREFIX + "-RM01-001_阶段1_测试.md")).write_text(
            "# 施工细则：测试件\n\n正文无档案头块。\n", encoding="utf-8")
        naming = [{"scope": "域A", "files": [r"表\d+\.md"]}]
        aud = DocsAuditor(tmp, naming=naming)
        aud.load()
        findings = aud.check()
        got = {(f.rule, f.file.rsplit("/", 1)[-1]) for f in findings}
        expect = {"LAYOUT-TABLE-GAP", "NAMING-FILE", "NAMING-SEQ", "LINK-DEAD",
                  "LINK-ABS-FILE-URI", "LINK-ANCHOR-DEAD", "MERMAID-SPECIAL-CHARS",
                  "LAYOUT-SECTION-STD", "LAYOUT-ARCHIVE-HEAD"}
        missing = expect - {r for r, _ in got}
        if missing:
            fails.append(f"未检出的规则: {missing}")
        mline = [l for l in (docs / "域A" / "图.md").read_text(encoding="utf-8").split("\n")
                 if "alias_slots" in l]
        if mline and not mline[0].strip().endswith('B[快照 alias_slots[]]'):
            fails.append(f"审查阶段不应改动原文: {mline}")
        applied_dry, _ = aud.fix(dry_run=True)
        if not applied_dry:
            fails.append("dry-run 未生成修复计划")
        if 'alias_slots[]"]' in (docs / "域A" / "图.md").read_text(encoding="utf-8"):
            fails.append("dry-run 写盘了（违反幂等约束）")
        applied, residual = aud.fix(dry_run=False)
        residual_rules = {f.rule for f in residual}
        for r in ("MERMAID-SPECIAL-CHARS", "LINK-ABS-FILE-URI", "LAYOUT-TABLE-GAP"):
            if r in residual_rules:
                fails.append(f"修复后残留: {r}")
        t = (docs / "域A" / "图.md").read_text(encoding="utf-8")
        if 'A["矮人大陆 (Kalar)"]' not in t or 'B["快照 alias_slots[]"]' not in t:
            fails.append("mermaid 引号修复结果不符")
        t2 = (docs / "域A" / "链接.md").read_text(encoding="utf-8")
        if "](表1.md)" not in t2:
            fails.append("file:/// 未转为正确的相对链接")
        if "不存在.md" not in t2:
            fails.append("修复误删死链（死链应只报不改）")
        if "LAYOUT-H1-MULTI" in {f.rule for f in findings}:
            fails.append("单 H1 文件误报多 H1")

        # ---- 基线棘轮：接受存量、阻断新增、更新基线闭环 ----
        base_path = tmp / "baseline.json"
        write_baseline(str(base_path), residual)
        base = load_baseline(str(base_path))
        if apply_baseline(residual, base) != 0:
            fails.append("基线快照复检不应产生新增违规")
        # 模拟 Agent 新增一处死链：超出基线 → 必须检出 1 条 is_new
        (docs / "域A" / "表1.md").write_text(
            "# 标题\n\n[新增死链](./没有.md)\n\n正文段落\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
            encoding="utf-8")
        aud2 = DocsAuditor(tmp, naming=naming)
        aud2.load()
        residual2 = aud2.check()
        new_n = apply_baseline(residual2, base)
        new_findings = [f for f in residual2 if f.is_new]
        if new_n != 1 or not new_findings or new_findings[0].rule != "LINK-DEAD":
            fails.append(f"棘轮未精确阻断新增违规（new={new_n}）")
        write_baseline(str(base_path), residual2)
        if apply_baseline(aud2.check(), load_baseline(str(base_path))) != 0:
            fails.append("更新基线后应清零新增")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if fails:
        print("【audit-docs self-test】失败:")
        for x in fails:
            print("  · " + x)
        return 1
    print("【audit-docs self-test】全部用例通过")
    return 0


def load_baseline(path: str) -> dict:
    """读取基线文件 → {(rule, file): count}。"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "docs-audit-baseline/v1":
        raise ValueError(f"基线 schema 不受支持: {data.get('schema')}")
    return {(e["rule"], e["file"]): e["count"] for e in data.get("entries", [])}


def apply_baseline(findings: list, base: dict) -> int:
    """棘轮比对：每 (rule,file) 前 base.get(key,0) 条视为已接受存量，超出部分标记 is_new。"""
    from collections import Counter
    emitted: dict = {}
    new = 0
    for f in findings:
        key = (f.rule, f.file)
        emitted[key] = emitted.get(key, 0) + 1
        f.is_new = emitted[key] > base.get(key, 0)
        if f.is_new:
            new += 1
    return new


def write_baseline(path: str, findings: list) -> None:
    """以当前 findings 快照写入基线（--update-baseline 专用，仅限真实消化存量后）。"""
    from collections import Counter
    from datetime import datetime
    c = Counter((f.rule, f.file) for f in findings)
    payload = {
        "schema": "docs-audit-baseline/v1",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "summary": {
            "errors": sum(1 for f in findings if RULES[f.rule][0] == SEV_ERROR),
            "warnings": sum(1 for f in findings if RULES[f.rule][0] == SEV_WARN),
        },
        "entries": [{"rule": r, "file": fl, "count": n} for (r, fl), n in sorted(c.items())],
    }
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    ensure_utf8_stdout()
    ap = argparse.ArgumentParser(description="docs/ 文档规范化静态审查与安全修复")
    ap.add_argument("--fix", action="store_true", help="应用安全修复（可修复类原位写回）")
    ap.add_argument("--dry-run", action="store_true", help="与 --fix 连用：演练不写盘")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON（Agent 直读）")
    ap.add_argument("--report", metavar="PATH", help="将 JSON 报告写入指定文件")
    ap.add_argument("--baseline", metavar="PATH", help="基线棘轮门禁：仅对超出基线的新增违规阻断")
    ap.add_argument("--update-baseline", metavar="PATH",
                    help="以当前发现写入基线（仅限真实消化存量后；禁止用于消音新增违规）")
    ap.add_argument("--rules", action="store_true", help="输出规则注册表+命名模式声明（JSON）后退出")
    ap.add_argument("--manifest", action="store_true",
                    help="输出全库 JSONL 机器清单（file/档号/阶段/标题）供 Agent grep 定位，禁止通读大索引")
    ap.add_argument("--time", action="store_true", help="输出各阶段耗时（性能巡检）")
    ap.add_argument("--self-test", action="store_true", help="运行内建夹具自测")
    args = ap.parse_args()

    if args.self_test:
        return cmd_self_test()
    if args.manifest:
        aud = DocsAuditor(ROOT)
        aud.load()
        for doc in sorted(aud.docs_map.values(), key=lambda d: d.rel):
            name = os.path.basename(str(doc.path))
            mc = re.search(KALAR_DEV_PREFIX + r"-(?:RM|FE)\d{2}-\d{3}", name)
            ms = re.search(r"阶段(\d)", name)
            h1 = next((ln[2:].strip() for ln in doc.lines if ln.startswith("# ")), "")
            print(json.dumps({"file": doc.rel,
                              "code": mc.group(0) if mc else "",
                              "stage": int(ms.group(1)) if ms else 0,
                              "title": h1[:80]}, ensure_ascii=False))
        return 0
    if args.dry_run and not args.fix:
        print("【audit-docs】--dry-run 需与 --fix 连用", file=sys.stderr)
        return 2
    if args.rules:
        print(json.dumps({"schema": "docs-audit-rules/v1",
                          "rules": {k: {"severity": v[0], "fixable": v[1], "desc": v[2]}
                                    for k, v in RULES.items()},
                          "naming_rules": NAMING_RULES},
                         ensure_ascii=False, indent=1))
        return 0

    timing = {}
    t0 = time.perf_counter()
    aud = DocsAuditor(ROOT, extra_files=[ROOT / "README.md"])
    aud.load()
    timing["load_ms"] = round((time.perf_counter() - t0) * 1000)

    t1 = time.perf_counter()
    applied = []
    if args.fix:
        # fix 模式跳过预检：只做修复后单趟复检（旧实现预检结果被丢弃，纯浪费）
        applied, findings = aud.fix(dry_run=args.dry_run)
        timing["fix_ms"] = round((time.perf_counter() - t1) * 1000)
        timing["audit_ms"] = 0
    else:
        findings = aud.check()
        timing["audit_ms"] = round((time.perf_counter() - t1) * 1000)
        timing["fix_ms"] = 0
    timing["total_ms"] = round((time.perf_counter() - t0) * 1000)

    if args.update_baseline:
        write_baseline(args.update_baseline, findings)
        print(f"【audit-docs】基线已写入 {args.update_baseline}"
              f"（{len(findings)} 条发现；仅限真实消化存量后使用）")
        return 0

    new_count = 0
    base = None
    if args.baseline:
        try:
            base = load_baseline(args.baseline)
        except FileNotFoundError:
            # CI 新环境/基线未入库时降级为全量严格门禁，而不是崩溃变红
            print(f"【audit-docs】基线文件不存在（{args.baseline}），按全量严格门禁执行", file=sys.stderr)
    if base is not None:
        new_count = apply_baseline(findings, base)

    # 规则级别容错查找：基线文件可能残留已下架规则 ID，未注册规则按 error 级降级处理而非 KeyError 崩溃
    def _rule_meta(rule_id: str) -> tuple:
        return RULES.get(rule_id, (SEV_ERROR, False, "未注册规则（基线残留或引擎下架）"))

    errors = [f for f in findings if _rule_meta(f.rule)[0] == SEV_ERROR]
    warns = [f for f in findings if _rule_meta(f.rule)[0] == SEV_WARN]
    by_rule: dict = {}
    for f in findings:
        by_rule[f.rule] = by_rule.get(f.rule, 0) + 1

    if args.json or args.report:
        payload = {
            "schema": "docs-audit/v1",
            "root": ROOT.name,
            "mode": "fix-dry-run" if (args.fix and args.dry_run) else ("fix" if args.fix else "check"),
            "summary": {"files": len(aud.docs_map), "errors": len(errors),
                        "warnings": len(warns), "new_violations": new_count,
                        "by_rule": by_rule, "fixes_applied": applied},
            "timing_ms": timing,
            "baseline": ({"path": args.baseline, "accepted": len(findings) - new_count}
                         if base is not None else None),
            "rules": {k: {"severity": v[0], "fixable": v[1], "desc": v[2]}
                      for k, v in RULES.items()},
            "findings": [f.to_dict() for f in findings],
        }
        js = json.dumps(payload, ensure_ascii=False, indent=2)
        if args.report:
            Path(args.report).write_text(js, encoding="utf-8")
        if args.json:
            print(js)
            return 0 if (new_count == 0 and not errors) else 1

    # 文本摘要（按规则分组，供人读）
    verb = "（演练，未写盘）" if (args.fix and args.dry_run) else \
           (f"，修复 {sum(a['fixes'] for a in applied)} 处 / {len(applied)} 份文件" if applied else "")
    print(f"【audit-docs】扫描 {len(aud.docs_map)} 份文档{verb}")
    for rule, meta in RULES.items():
        items = [f for f in findings if f.rule == rule and (base is None or f.is_new)]
        if not items:
            continue
        tag = "新增违规" if base is not None else rule
        print(f"\n■ {rule}（{meta[0]}{'，可自动修复' if meta[1] else ''}）× {len(items)}"
              + ("  ← 新增" if base is not None else ""))
        for f in items[:8]:
            loc = f"{f.file}:{f.line}" if f.line else f.file
            print(f"  · {loc} — {f.message}")
            if f.suggestion:
                print(f"      ↳ 建议: {f.suggestion[:110]}")
        if len(items) > 8:
            print(f"  … 另 {len(items) - 8} 处（--json 查看全量）")
    print(f"\n【审查结论】error {len(errors)} / warn {len(warns)}"
          + (f" / 新增违规 {new_count}（存量已接受 {len(findings) - new_count}）" if base is not None else ""))
    if args.time:
        print(f"【审查结论】耗时 load {timing['load_ms']}ms + audit {timing['audit_ms']}ms"
              f" + fix {timing['fix_ms']}ms = {timing['total_ms']}ms")
    if base is not None:
        if new_count:
            print("【审查结论】未通过（存在超出基线的新增违规，Agent 不得合入）")
            return 1
        print("【审查结论】通过（无新增违规）")
        return 0
    if errors:
        print("【审查结论】未通过（存在 error 级发现）")
        return 1
    print("【审查结论】通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
