#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 简化与防过度设计门禁)
# 文件路径: WebGames/scripts/py/gd/simplification_rules.py
# 架构定位: GDScript 复杂度控制、冗余抑制与循环瞬态分配审查引擎 (GDScript Simplification Auditor)
# 依赖与触发: 触发方: audit_gd.py | 上游: backend/**/*.gd | 下游: 门禁控制台与 JSON 报告 | 运行时: Python 3.10+
# 职责说明: 强校验继承深度（≤ 2 层）、嵌套深度（≤ 5 层）、冗余 pass、ADV-PRF-002 循环内瞬态分配及布尔简化
# 退出语义与设计依据: 退出码: 0=合规, 1=存在阻断违规 | 设计依据: SIM-INH-001/SIM-DED-001/ADV-PRF-002
# ------------------------------------------------------------------------------
# 用法示例:
#   from gd.simplification_rules import run_simplification_audit
# ==============================================================================
"""GDScript 过度工程化防御、简化规范与循环内瞬态分配审查实现。"""

from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import re

from gd.gd_common import (
    LOOP_RE,
    ROOT,
    GDFileCache,
    get_gd_files,
    get_rules_config,
)
CLS_DECL_RE = re.compile(r"^\s*class_name\s+([A-Za-z0-9_]+)")
EXTENDS_RE = re.compile(r"^\s*extends\s+([A-Za-z0-9_]+)")
FUNC_DEF_RE = re.compile(r"^\s*(?:static\s+)?func\s+([A-Za-z0-9_]+)\s*\(")
PASS_RE = re.compile(r"^\s*pass\s*(#.*)?$")
ADV_PRF_002_ALLOC_RE = re.compile(r"(?:\.new\s*\(|\.duplicate\s*\()")


@dataclass(slots=True)
class SimplificationFinding:
    """简化审查发现问题载荷。"""

    rule_id: str
    level: str  # ERROR, WARN, INFO
    file_path: Path
    line_number: int
    message: str
    fix_suggestion: str = ""


class SimplificationAuditor:
    """过度工程化防御与代码简化审查器。"""

    def __init__(self, rules_data: dict[str, Any]) -> None:
        self.rules_config = rules_data.get("simplification_rules", {})
        self.exemptions = rules_data.get("exemptions", {})
        self.findings: list[SimplificationFinding] = []
        self.class_hierarchy: dict[str, str] = {}
        self.class_to_file: dict[str, Path] = {}

    def is_exempt(self, rule_id: str, file_rel_posix: str) -> bool:
        """检查特定文件是否豁免某条规则。"""
        by_file = self.exemptions.get("by_file", {})
        if file_rel_posix in by_file and rule_id in by_file[file_rel_posix]:
            return True

        by_prefix = self.exemptions.get("by_path_prefix", {})
        for prefix, rule_list in by_prefix.items():
            if file_rel_posix.startswith(prefix) and rule_id in rule_list:
                return True
        return False

    def build_hierarchy_map(self, files: list[Path]) -> None:
        """预先构建类继承拓扑字典。"""
        for f in files:
            try:
                text, _ = GDFileCache.get(f)
                m_cls = CLS_DECL_RE.search(text)
                m_ext = EXTENDS_RE.search(text)
                if m_cls:
                    cname = m_cls.group(1)
                    bname = m_ext.group(1) if m_ext else "RefCounted"
                    self.class_hierarchy[cname] = bname
                    self.class_to_file[cname] = f
            except (OSError, UnicodeDecodeError) as exc:
                print(f"[WARN] 读取文件分析继承链失败: {f} ({exc})")

    def get_inheritance_depth(self, class_name: str, visited: set[str] | None = None) -> int:
        """递归计算继承链深度。"""
        if visited is None:
            visited = set()
        if class_name in visited:
            return 0
        visited.add(class_name)

        base = self.class_hierarchy.get(class_name)
        if not base or base in {
            "RefCounted",
            "Object",
            "Node",
            "Control",
            "Resource",
            "Node2D",
        }:
            return 1
        if base in self.class_hierarchy:
            return 1 + self.get_inheritance_depth(base, visited)
        return 2

    def audit_inheritance_depth(self) -> None:
        """SIM-INH-001: 校验继承深度（≤ 2 层）。"""
        rule = self.rules_config.get("SIM-INH-001", {})
        level = rule.get("level", "ERROR")

        for cname, f in self.class_to_file.items():
            rel = f.relative_to(ROOT)
            rel_posix = rel.as_posix()
            if self.is_exempt("SIM-INH-001", rel_posix):
                continue

            depth = self.get_inheritance_depth(cname)
            if depth > 2:
                self.findings.append(
                    SimplificationFinding(
                        rule_id="SIM-INH-001",
                        level=level,
                        file_path=rel,
                        line_number=1,
                        message=f"类「{cname}」继承深度达 {depth} 层（超过上限 2 层），存在过度继承风险",
                        fix_suggestion=rule.get("fix_suggestion", "将深层继承树重构为平铺领域类 + 组合策略模式"),
                    )
                )

    def _check_pass_redundancy(self, lines: list[str], i: int, rel: Path, rel_posix: str) -> None:
        """检查无意义的 pass 冗余 (SIM-DED-001)。"""
        if self.is_exempt("SIM-DED-001", rel_posix) or i <= 1:
            return
        prev_code = lines[i - 2].split("#")[0].strip()
        control_kw = ("func", "class", "if", "else", "elif", "for", "while", "match")
        if prev_code and not prev_code.endswith(":") and not prev_code.startswith(control_kw):
            rule = self.rules_config.get("SIM-DED-001", {})
            self.findings.append(
                SimplificationFinding(
                    rule_id="SIM-DED-001",
                    level=rule.get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="在已执行语句后检测到多余冗余的「pass」语句",
                    fix_suggestion="直接删除无效的 pass 行",
                )
            )

    def _check_loop_alloc(self, lines: list[str], i: int, indent: int, rel: Path, rel_posix: str) -> None:
        """检查循环内瞬态堆分配 (ADV-PRF-002)。"""
        if self.is_exempt("ADV-PRF-002", rel_posix):
            return
        for j in range(i, len(lines)):
            body_raw = lines[j]
            body_code = body_raw.split("#")[0]
            if not body_code.strip():
                continue
            body_indent = len(body_raw) - len(body_raw.lstrip())
            if body_indent <= indent:
                break
            if not ADV_PRF_002_ALLOC_RE.search(body_code):
                continue
            self.findings.append(
                SimplificationFinding(
                    rule_id="ADV-PRF-002",
                    level=self.rules_config.get("ADV-PRF-002", {}).get("level", "WARN"),
                    file_path=rel,
                    line_number=j + 1,
                    message="循环体内出现逐次瞬态堆分配（.new() / .duplicate()），热路径下将持续触发 GC 停顿",
                    fix_suggestion="将分配提到循环外复用，或改用对象池（池化对象须实现 reset_state()）",
                )
            )
            break

    def _check_bool_return(self, lines: list[str], i: int, stripped: str, rel: Path, rel_posix: str) -> None:
        """检查冗余布尔三元分支 (SIM-DED-001)。"""
        if self.is_exempt("SIM-DED-001", rel_posix):
            return
        lower_str = stripped.lower()
        has_true = "return true" in lower_str
        has_false = "return false" in lower_str
        if not (has_true or has_false):
            return
        target_bool = "return false" if has_true else "return true"

        j, next_code = _next_non_empty_code_line(lines, i)
        if not next_code.startswith("else"):
            return
        _, else_code = _next_non_empty_code_line(lines, j + 1)
        if target_bool in else_code.lower():
            rule = self.rules_config.get("SIM-DED-001", {})
            self.findings.append(
                SimplificationFinding(
                    rule_id="SIM-DED-001",
                    level=rule.get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="检测到冗余布尔三元分支（if ...: return true/false else: return false/true）",
                    fix_suggestion="直接返回条件表达式布尔值：return <condition> 或 return not <condition>",
                )
            )

    def _record_func_nesting_if_needed(
        self, in_func: bool, max_nesting: int, func_name: str, start_line: int, rel: Path, rel_posix: str
    ) -> None:
        """若函数最大嵌套超限则记录发现 (SIM-CMP-001)。"""
        if in_func and max_nesting > 5 and not self.is_exempt("SIM-CMP-001", rel_posix):
            rule = self.rules_config.get("SIM-CMP-001", {})
            self.findings.append(
                SimplificationFinding(
                    rule_id="SIM-CMP-001",
                    level=rule.get("level", "WARN"),
                    file_path=rel,
                    line_number=start_line,
                    message=f"函数「{func_name}」控制流最大嵌套深度达 {max_nesting} 层（超限 5 层），认知负荷过高",
                    fix_suggestion="采用卫语句（Guard Clauses）前置校验早期返回，或提炼子求解器函数",
                )
            )

    def _track_control_flow_nesting(
        self, stripped: str, indent: int, nesting_depth: int, max_nesting: int
    ) -> tuple[bool, int, int]:
        """计算当前行是否结束函数作用域，并更新控制流嵌套深度。"""
        if indent == 0 and not stripped.startswith("#"):
            return False, 0, max_nesting

        if stripped.startswith(("if ", "for ", "while ", "match ", "elif ", "else:")):
            nesting_depth += 1
            max_nesting = max(max_nesting, nesting_depth)
        elif indent < nesting_depth * 4 and nesting_depth > 0:
            nesting_depth = max(0, indent // 4)
        return True, nesting_depth, max_nesting

    def audit_file_content(self, path: Path) -> None:
        """审查单个文件内部的控制流复杂度与简化异味。"""
        rel = path.relative_to(ROOT)
        rel_posix = rel.as_posix()

        try:
            _, lines = GDFileCache.get(path)
        except Exception:
            return

        in_func = False
        func_start_line = 0
        func_name = ""
        nesting_depth = 0
        max_func_nesting = 0

        for i, ln in enumerate(lines, 1):
            code_line = ln.split("#")[0].rstrip()
            stripped = code_line.strip()
            if not stripped:
                continue

            indent = len(ln) - len(ln.lstrip())

            if PASS_RE.match(ln):
                self._check_pass_redundancy(lines, i, rel, rel_posix)

            if LOOP_RE.match(stripped):
                self._check_loop_alloc(lines, i, indent, rel, rel_posix)

            self._check_bool_return(lines, i, stripped, rel, rel_posix)

            m_fn = FUNC_DEF_RE.match(ln)
            if m_fn:
                self._record_func_nesting_if_needed(
                    in_func, max_func_nesting, func_name, func_start_line, rel, rel_posix
                )
                in_func = True
                func_start_line = i
                func_name = m_fn.group(1)
                nesting_depth = 0
                max_func_nesting = 0
            elif in_func:
                in_func, nesting_depth, max_func_nesting = self._track_control_flow_nesting(
                    stripped, indent, nesting_depth, max_func_nesting
                )

        self._record_func_nesting_if_needed(
            in_func, max_func_nesting, func_name, func_start_line, rel, rel_posix
        )


def _print_simplification_json_report(auditor: SimplificationAuditor, files: list[Path], strict: bool) -> int:
    """输出 JSON 格式简化审查报告并返回退出码。"""
    errors = [fd for fd in auditor.findings if fd.level == "ERROR"]
    warns = [fd for fd in auditor.findings if fd.level == "WARN"]
    infos = [fd for fd in auditor.findings if fd.level == "INFO"]
    passed = len(errors) == 0 and (not strict or len(warns) == 0)
    res = {
        "total_files": len(files),
        "errors": len(errors),
        "warns": len(warns),
        "infos": len(infos),
        "passed": passed,
        "findings": [
            {
                "rule_id": fd.rule_id,
                "level": fd.level,
                "file": str(fd.file_path),
                "line": fd.line_number,
                "message": fd.message,
                "suggestion": fd.fix_suggestion,
            }
            for fd in auditor.findings
        ],
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if passed else 1


def _next_non_empty_code_line(lines: list[str], start_idx: int) -> tuple[int, str]:
    """寻找下一行非空有效代码，跳过纯空白与注释。"""
    j = start_idx
    while j < len(lines):
        code = lines[j].split("#")[0].strip()
        if code:
            return j, code
        j += 1
    return len(lines), ""


def _partition_simplification_findings(findings: list[SimplificationFinding]) -> tuple[int, int, int]:
    """单趟统计 ERROR / WARN / INFO 计数 (ADV-PRF-002)。"""
    counts = {"ERROR": 0, "WARN": 0, "INFO": 0}
    for fd in findings:
        lvl = fd.level
        if lvl in counts:
            counts[lvl] += 1
    return counts["ERROR"], counts["WARN"], counts["INFO"]


def _print_simplification_finding_lines(findings: list[SimplificationFinding]) -> None:
    """格式化打印单条过度工程化发现。"""
    icon_map = {"ERROR": "❌", "WARN": "⚠️", "INFO": "ℹ️"}
    for fd in findings:
        icon = icon_map.get(fd.level, "ℹ️")
        print(f"  {icon} [{fd.rule_id}][{fd.level}] {fd.file_path}:{fd.line_number} — {fd.message}")
        if fd.fix_suggestion:
            print(f"     💡 修复建议: {fd.fix_suggestion}")


def _determine_simplification_verdict(n_errors: int, n_warns: int, strict: bool) -> bool:
    """判定过度工程化门禁结论。"""
    if strict:
        return n_errors == 0 and n_warns == 0
    return n_errors == 0


def _print_simplification_console_report(auditor: SimplificationAuditor, files: list[Path], strict: bool) -> int:
    """输出控制台看板格式报告并返回退出码。"""
    n_err, n_warn, n_info = _partition_simplification_findings(auditor.findings)

    print("=" * 80)
    print("🧹 卡拉尔世界引擎：过度工程化防御与代码简化审查 (Simplification Gate)")
    print("=" * 80)
    print(f"  • 审查源文件总数: {len(files)} 个")
    print(f"  • 审查发现: ERROR {n_err} 项 | WARN {n_warn} 项 | INFO {n_info} 项")
    print("-" * 80)

    _print_simplification_finding_lines(auditor.findings)

    is_ok = _determine_simplification_verdict(n_err, n_warn, strict)
    print("=" * 80)
    if is_ok:
        print("【审查结论】通过（无过度设计与无意义冗余）")
        return 0
    print("【审查结论】未通过（存在严重过度设计或代码堆砌）")
    return 1


def run_simplification_audit(strict: bool = False, json_output: bool = False, slice_name: str = "") -> int:
    """执行过度工程化防御审查主循环。"""
    rules_data = get_rules_config()
    auditor = SimplificationAuditor(rules_data)

    files = get_gd_files()
    if slice_name:
        files = [f for f in files if slice_name.lower() in f.as_posix().lower()]

    auditor.build_hierarchy_map(files)
    auditor.audit_inheritance_depth()

    for f in files:
        auditor.audit_file_content(f)

    if json_output:
        return _print_simplification_json_report(auditor, files, strict)
    return _print_simplification_console_report(auditor, files, strict)
