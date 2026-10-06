#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档审查中枢)
# 文件路径: WebGames/scripts/py/docs_audit/auditor.py
# 架构定位: 文档治理调度中枢 (DocsAuditor Core Engine)
# 依赖与触发: 触发方: audit_docs.py / 外部调度器 | 上游: docs_audit 审查子域 | 下游: 门禁聚合与修复回盘 | 运行时: Python 3.10+
# 职责说明: DocsAuditor 调度核心：单趟索引构建、各子域门禁分发与安全自动修复回盘
# 退出语义与设计依据: 退出码: 纯核心类无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   auditor = DocsAuditor(root)
# ==============================================================================
"""DocsAuditor 调度核心：单趟索引构建、各子域门禁分发与安全自动修复回盘。"""
import os
import re
from pathlib import Path
from typing import Any

from docs_audit.layout import check_layout
from docs_audit.links import check_links, fix_abs_links, resolve_abs_target
from docs_audit.mermaid import check_mermaid, mermaid_fix_line
from docs_audit.models import (
    BR_TAG_RE,
    DOCS_DIR,
    Doc,
    FENCE_RE,
    Finding,
    HEADING_NOSPACE_RE,
    HEADING_PLAIN_RE,
    LIST_PREFIX_RE,
    NAMING_RULES,
    TABLE_ROW_RE,
    WS_TAIL_RE,
    slugify,
    split_fences,
)
from docs_audit.naming import check_naming
from docs_audit.phase import check_formation_date, check_phase_governance


class DocsAuditor:
    def __init__(
        self,
        root: Path,
        docs_dir: str = DOCS_DIR,
        naming: Any = None,
        extra_files: Any = None,
    ) -> None:
        self.root = root
        self.docs = root / docs_dir
        self.naming = naming if naming is not None else NAMING_RULES
        self.docs_map: dict = {}       # str(绝对路径) -> Doc
        self.decode_errors: dict = {}
        self.dir_index: dict = {}      # str(目录绝对路径) -> [子项绝对路径]（单趟 walk，命名域复用）
        self.extra_files = [Path(p) for p in (extra_files or [])]  # docs/ 之外的门禁覆盖件（如根 README）
        self._transient: dict = {}

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

    def _abs_target(self, frag: str) -> str:
        return resolve_abs_target(frag, self.docs)

    def _add(self, doc: Any, rule: str, line: int, message: str, suggestion: str = "", extra: Any = None) -> None:
        self._current_findings.append(Finding(rule, doc.rel, line, message, suggestion, extra or {}))

    # ---------- 审查 ----------
    def check(self) -> list:
        findings: list = []
        self._current_findings = findings
        self._transient = {}   # 按需加载的锚点目标（不并入正式审计集合）
        for doc in list(self.docs_map.values()):
            check_layout(doc, self.decode_errors, self._add)
            check_mermaid(doc, self._add)
            check_links(
                doc,
                self.docs_map,
                self._add,
                self._get_doc,
                self._abs_target,
                self._rel,
            )
        check_naming(self.docs, self.dir_index, self.naming, self.docs_map, self._rel, findings)
        check_formation_date(self.docs, self._rel, findings)
        check_phase_governance(self.docs, self.docs_map, self._rel, findings)
        findings.sort(key=lambda f: (f.file, f.line, f.rule))
        return findings

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
            new_text, n_abs = fix_abs_links("\n".join(new_lines), doc.path, self._abs_target)
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

