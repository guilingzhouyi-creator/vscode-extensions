#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 高级规范门禁)
# 文件路径: WebGames/scripts/py/gd/advanced_rules.py
# 架构定位: GDScript 高级架构防腐、强类型与防确定性溢出审查引擎 (GDScript Advanced Auditor)
# 依赖与触发: 触发方: audit_gd.py | 上游: backend/**/*.gd | 下游: 门禁控制台与 JSON 报告 | 运行时: Python 3.10+
# 职责说明: 强校验领域模型防腐性、变量/函数强类型注解、确定性随机沙盒及私有访问边界
# 退出语义与设计依据: 退出码: 0=合规, 1=存在阻断违规 | 设计依据: ADV-PRF-001/ADV-RNG-001/ADV-TYP-001
# ------------------------------------------------------------------------------
# 用法示例:
#   from gd.advanced_rules import run_advanced_audit
# ==============================================================================
"""GDScript 高级架构、强类型标注与领域防腐审查实现。"""

from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import re

from gd.gd_common import (
    FILE_NAME_RE,
    LOOP_RE,
    ROOT,
    SNAKE_RE,
    GDFileCache,
    get_gd_files,
    get_rules_config,
)
VAR_DECL_RE = re.compile(r"^\s*(?:static\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)")
FUNC_DECL_RE = re.compile(
    r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)(?:\s*->\s*([A-Za-z0-9_\[\],\s.]+))?:"
)
FORBIDDEN_EXTENDS_DOMAINS = {
    "Node",
    "Node2D",
    "Node3D",
    "Control",
    "CanvasItem",
    "Area2D",
    "CharacterBody2D",
}
FORBIDDEN_RNG_CALLS = re.compile(
    r"(?<![.\w])(randf|randi|randomize|randf_range|randi_range|randfn)\s*\("
)


def _strip_gd_comment(line: str) -> str:
    """引号感知剥离行内 GDScript 注释，防止字符串内 `#` 掩盖同行违规。"""
    quote_char = ""
    escaped = False
    for idx, ch in enumerate(line):
        if escaped:
            escaped = False
            continue
        if ch == "\\" and quote_char:
            escaped = True
            continue
        if ch in ('"', "'"):
            if not quote_char:
                quote_char = ch
            elif quote_char == ch:
                quote_char = ""
            continue
        if ch == "#" and not quote_char:
            return line[:idx].rstrip()
    return line.rstrip()


@dataclass(slots=True)
class Finding:
    """高级代码审查问题载荷。"""

    rule_id: str
    level: str  # ERROR, WARN, INFO
    file_path: Path
    line_number: int
    message: str
    fix_suggestion: str = ""


class AdvancedCodeAuditor:
    """高级代码规范审查器。"""

    def __init__(self, rules_data: dict[str, Any]) -> None:
        self.rules_config = rules_data.get("advanced_rules", {})
        self.exemptions = rules_data.get("exemptions", {})
        self.findings: list[Finding] = []

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

    def _check_filename(self, path: Path, rel: Path, rel_posix: str) -> None:
        """检查文件名 snake_case 规范 (ADV-NAM-001)。"""
        if not FILE_NAME_RE.match(path.name) and not self.is_exempt("ADV-NAM-001", rel_posix):
            rule = self.rules_config.get("ADV-NAM-001", {})
            self.findings.append(
                Finding(
                    rule_id="ADV-NAM-001",
                    level=rule.get("level", "ERROR"),
                    file_path=rel,
                    line_number=1,
                    message=f"文件名「{path.name}」不符合 snake_case 命名规范",
                    fix_suggestion="重命名为小写下划线格式（如 item_service.gd）",
                )
            )

    def _check_domain_corruption(self, text: str, rel: Path, rel_posix: str) -> None:
        """检查领域模型防腐性 (ADV-DEC-001)。"""
        if rel_posix.startswith("backend/domains/") and not self.is_exempt("ADV-DEC-001", rel_posix):
            m_ext = re.search(r"^\s*extends\s+([A-Za-z0-9_]+)", text, re.MULTILINE)
            if m_ext:
                base_class = m_ext.group(1)
                if base_class in FORBIDDEN_EXTENDS_DOMAINS:
                    rule = self.rules_config.get("ADV-DEC-001", {})
                    self.findings.append(
                        Finding(
                            rule_id="ADV-DEC-001",
                            level=rule.get("level", "ERROR"),
                            file_path=rel,
                            line_number=text[: m_ext.start()].count("\n") + 1,
                            message=f"后端纯领域模型类严禁继承场景树节点「{base_class}」",
                            fix_suggestion=rule.get("fix_suggestion", "将基类改为 RefCounted 或 Object"),
                        )
                    )

    def _update_loop_stack(self, ln: str, stripped: str, indent: int, loop_stack: list[int]) -> None:
        """跟踪循环嵌套缩进栈 (ADV-PRF-001)。"""
        if LOOP_RE.match(ln):
            while loop_stack and loop_stack[-1] >= indent:
                loop_stack.pop()
            loop_stack.append(indent)
        elif loop_stack and indent <= loop_stack[-1] and not stripped.startswith(("else", "elif")):
            while loop_stack and loop_stack[-1] >= indent:
                loop_stack.pop()

    def _check_var_decl(self, ln: str, i: int, rel: Path, rel_posix: str) -> None:
        """检查变量声明强类型 (ADV-TYP-001) 与命名 (ADV-NAM-001)。"""
        m_var = VAR_DECL_RE.match(ln)
        if not m_var:
            return
        var_name = m_var.group(1)
        if not SNAKE_RE.match(var_name) and not self.is_exempt("ADV-NAM-001", rel_posix):
            rule = self.rules_config.get("ADV-NAM-001", {})
            self.findings.append(
                Finding(
                    rule_id="ADV-NAM-001",
                    level=rule.get("level", "ERROR"),
                    file_path=rel,
                    line_number=i,
                    message=f"变量名「{var_name}」不符合 snake_case 规范",
                    fix_suggestion=rule.get("fix_suggestion", ""),
                )
            )

        if not self.is_exempt("ADV-TYP-001", rel_posix):
            after_var = ln[m_var.end() :].strip()
            rule = self.rules_config.get("ADV-TYP-001", {})
            if after_var.startswith("="):
                self.findings.append(
                    Finding(
                        rule_id="ADV-TYP-001",
                        level=rule.get("level", "WARN"),
                        file_path=rel,
                        line_number=i,
                        message=f"变量「{var_name}」采用隐式弱类型分配（var =），建议使用显式声明 (: Type =) 或推断 (:=)",
                        fix_suggestion=f"改用 `var {var_name} := ...` 或指定具体类型 `var {var_name}: Type = ...`",
                    )
                )
            elif not after_var.startswith(":") and not after_var.startswith("("):
                self.findings.append(
                    Finding(
                        rule_id="ADV-TYP-001",
                        level=rule.get("level", "WARN"),
                        file_path=rel,
                        line_number=i,
                        message=f"变量「{var_name}」缺少显式类型标注",
                        fix_suggestion=f"显式补充类型注解，如 `var {var_name}: String`",
                    )
                )

    def _extract_func_signature(self, ln: str, i: int, lines: list[str]) -> tuple[str, str] | None:
        """提取跨行函数声明的名字与参数列表字符串。"""
        if not re.match(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", ln):
            return None
        accum_sig = ln.split("#")[0].strip()
        look_idx = i
        while look_idx < len(lines) and not re.search(r"\)\s*(?:->\s*[^:]+)?\s*:", accum_sig):
            accum_sig += " " + lines[look_idx].split("#")[0].strip()
            look_idx += 1
        m_func = FUNC_DECL_RE.match(accum_sig)
        if not m_func:
            m_func = re.match(
                r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)(?:\s*->\s*([A-Za-z0-9_\[\],\s.]+))?:",
                accum_sig,
            )
        if not m_func:
            return None
        return m_func.group(1), m_func.group(2).strip()

    def _validate_func_name_and_params(
        self, func_name: str, params_str: str, i: int, rel: Path, rel_posix: str
    ) -> None:
        """校验函数命名与形参类型标注契约。"""
        if not SNAKE_RE.match(func_name) and not self.is_exempt("ADV-NAM-001", rel_posix):
            rule = self.rules_config.get("ADV-NAM-001", {})
            self.findings.append(
                Finding(
                    rule_id="ADV-NAM-001",
                    level=rule.get("level", "ERROR"),
                    file_path=rel,
                    line_number=i,
                    message=f"函数名「{func_name}」不符合 snake_case 规范",
                )
            )

        if params_str and not self.is_exempt("ADV-TYP-002", rel_posix):
            params = [p.strip() for p in params_str.split(",") if p.strip()]
            for p in params:
                if not re.search(r"[:=]", p):
                    rule = self.rules_config.get("ADV-TYP-002", {})
                    self.findings.append(
                        Finding(
                            rule_id="ADV-TYP-002",
                            level=rule.get("level", "ERROR"),
                            file_path=rel,
                            line_number=i,
                            message=f"函数「{func_name}」参数「{p}」缺少显式类型注解",
                            fix_suggestion="为参数补充强类型，如 param_name: int",
                        )
                    )

    def _check_func_decl(self, ln: str, i: int, lines: list[str], rel: Path, rel_posix: str) -> None:
        """检查函数声明类型完整性 (ADV-TYP-002) 与命名。"""
        extracted = self._extract_func_signature(ln, i, lines)
        if not extracted:
            return
        func_name, params_str = extracted
        self._validate_func_name_and_params(func_name, params_str, i, rel, rel_posix)

    def _check_rng_and_config(
        self, code_line: str, i: int, rel: Path, rel_posix: str, loop_stack: list[int]
    ) -> None:
        """检查随机性沙盒与 GameConfig 读取规则。"""
        if FORBIDDEN_RNG_CALLS.search(code_line) and not self.is_exempt("ADV-RNG-001", rel_posix):
            rule = self.rules_config.get("ADV-RNG-001", {})
            self.findings.append(
                Finding(
                    rule_id="ADV-RNG-001",
                    level=rule.get("level", "ERROR"),
                    file_path=rel,
                    line_number=i,
                    message="严禁调用 Godot 全局非确定性随机函数（randf/randi/randomize）",
                    fix_suggestion=rule.get("fix_suggestion", "使用 DeterministicRNG 替代"),
                )
            )

        if "GameConfig.get_value(" in code_line and not self.is_exempt("ADV-CFG-001", rel_posix):
            self.findings.append(
                Finding(
                    rule_id="ADV-CFG-001",
                    level=self.rules_config.get("ADV-CFG-001", {}).get("level", "ERROR"),
                    file_path=rel,
                    line_number=i,
                    message="禁止外部调用 GameConfig.get_value（返回无类型 Variant）",
                    fix_suggestion="改用类型化读取方法：get_int / get_float / get_string / get_dict / get_array",
                )
            )

        if loop_stack and "GameConfig.get_" in code_line and not self.is_exempt("ADV-PRF-001", rel_posix):
            self.findings.append(
                Finding(
                    rule_id="ADV-PRF-001",
                    level=self.rules_config.get("ADV-PRF-001", {}).get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="循环体内重复读取 GameConfig 配置，属于热点性能隐患",
                    fix_suggestion="将配置读取提取至循环体外作为局部常量/变量缓存",
                )
            )

    def _check_boundary_and_closure(
        self, code_line: str, i: int, rel: Path, rel_posix: str
    ) -> None:
        """检查跨域防腐私有访问与闭包安全性。"""
        if rel_posix.startswith("backend/domains/") and not self.is_exempt("ADV-BND-001", rel_posix):
            m_priv = re.search(
                r"(?<!\bself)(?<!\bsuper)\b([a-z][a-z0-9_]*_(?:service|manager|engine|pipeline))\._([a-z][a-z0-9_]+)\b",
                code_line,
            )
            if m_priv:
                self.findings.append(
                    Finding(
                        rule_id="ADV-BND-001",
                        level=self.rules_config.get("ADV-BND-001", {}).get("level", "ERROR"),
                        file_path=rel,
                        line_number=i,
                        message=f"跨对象直接访问私有成员「{m_priv.group(1)}.__{m_priv.group(2)}」，破坏领域防腐封装",
                        fix_suggestion=self.rules_config.get("ADV-BND-001", {}).get("fix_suggestion", "改用公开 API 方法或通过事件解耦交互"),
                    )
                )

        is_lambda = "func(" in code_line and not code_line.startswith("func ") and not code_line.startswith("static func ")
        if is_lambda and not self.is_exempt("ADV-LAM-001", rel_posix) and re.search(r"\bvar\s+_\w+\s*=", code_line):
            self.findings.append(
                Finding(
                    rule_id="ADV-LAM-001",
                    level=self.rules_config.get("ADV-LAM-001", {}).get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="Lambda 表达式中声明或修改捕获变量，可能存在生命周期与值拷贝安全隐患",
                    fix_suggestion=self.rules_config.get("ADV-LAM-001", {}).get("fix_suggestion", "使用 Callable 或将状态封装于 RefCounted 容器中"),
                )
            )

    def _check_type_and_signals(
        self, code_line: str, i: int, rel: Path, rel_posix: str
    ) -> None:
        """检查动态容器盲目推断与信号参数完整性。"""
        if (
            re.search(r"^\s*var\s+[a-zA-Z0-9_]+\s*:=\s*[a-zA-Z0-9_]+\.(?:get|pop_front|pop_back)\s*\(", code_line)
            and not self.is_exempt("ADV-TYP-003", rel_posix)
        ):
            self.findings.append(
                Finding(
                    rule_id="ADV-TYP-003",
                    level=self.rules_config.get("ADV-TYP-003", {}).get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="对动态容器返回值使用 := 盲目推断为 Variant，隐藏类型缺陷",
                    fix_suggestion=self.rules_config.get("ADV-TYP-003", {}).get("fix_suggestion", "显式声明类型并增加空值卫语句守卫"),
                )
            )

        if ("emit_signal(" in code_line or ".emit(" in code_line) and not self.is_exempt("ADV-SIG-001", rel_posix):
            if re.search(r"\.emit\(\s*null\s*\)", code_line):
                self.findings.append(
                    Finding(
                        rule_id="ADV-SIG-001",
                        level=self.rules_config.get("ADV-SIG-001", {}).get("level", "ERROR"),
                        file_path=rel,
                        line_number=i,
                        message="信号发射传参裸传 null，可能引发接收方空指针解构崩溃",
                        fix_suggestion=self.rules_config.get("ADV-SIG-001", {}).get("fix_suggestion", "核对信号声明签名并确保发射传参一一对应"),
                    )
                )

    def _check_pool_lifecycle_contract(
        self, text: str, lines: list[str], rel: Path, rel_posix: str
    ) -> None:
        """ADV-POOL-001: 校验可池化 DTO 与对象池契约类均实现完整 reset_state() 与超类复位。"""
        rule_cfg = self.rules_config.get("ADV-POOL-001", {})
        if self.is_exempt("ADV-POOL-001", rel_posix):
            return
        is_pool_subclass = bool(re.search(r"^\s*extends\s+PoolableDtoBase\b", text, re.MULTILINE))
        defines_pool_hooks = (
            "func mark_pooled_acquire(" in text or "func mark_pooled_release(" in text
        )
        if not is_pool_subclass and not defines_pool_hooks:
            return
        has_reset_method = "func reset_state(" in text
        has_instance_vars = any(
            ln.lstrip() == ln and VAR_DECL_RE.match(ln) and not ln.lstrip().startswith("static ")
            for ln in lines
        )
        if defines_pool_hooks and not has_reset_method:
            self.findings.append(
                Finding(
                    rule_id="ADV-POOL-001",
                    level=rule_cfg.get("level", "ERROR"),
                    file_path=rel,
                    line_number=1,
                    message="声明了对象池生命周期钩子的类必须实现 reset_state() 状态重置接口",
                    fix_suggestion=rule_cfg.get("fix_suggestion", "为可池化对象实现 reset_state() -> void 方法以确保状态彻底复位"),
                )
            )
            return
        if is_pool_subclass and has_instance_vars and not has_reset_method:
            self.findings.append(
                Finding(
                    rule_id="ADV-POOL-001",
                    level=rule_cfg.get("level", "ERROR"),
                    file_path=rel,
                    line_number=1,
                    message="继承 PoolableDtoBase 且含实例字段的类必须重写 reset_state() 彻底复位字段",
                    fix_suggestion=rule_cfg.get("fix_suggestion", "重写 func reset_state() -> void 并在首行调用 super.reset_state()"),
                )
            )
            return
        if is_pool_subclass and has_reset_method and "super.reset_state()" not in text:
            reset_line = next(
                (idx for idx, ln in enumerate(lines, 1) if "func reset_state(" in ln),
                1,
            )
            self.findings.append(
                Finding(
                    rule_id="ADV-POOL-001",
                    level=rule_cfg.get("level", "ERROR"),
                    file_path=rel,
                    line_number=reset_line,
                    message="PoolableDtoBase 子类重写 reset_state() 时必须调用 super.reset_state() 以维持复用代数校验",
                    fix_suggestion=rule_cfg.get("fix_suggestion", "在 reset_state() 中调用 super.reset_state()"),
                )
            )

    def _check_line_patterns(
        self, code_line: str, i: int, rel: Path, rel_posix: str, loop_stack: list[int]
    ) -> None:
        """检查行内模式规则（RNG、Config、私有访问、Lambda、信号）。"""
        self._check_rng_and_config(code_line, i, rel, rel_posix, loop_stack)
        self._check_boundary_and_closure(code_line, i, rel, rel_posix)
        self._check_type_and_signals(code_line, i, rel, rel_posix)

    def audit_file(self, path: Path) -> None:
        """对单个文件执行高级架构与强类型规范审查。"""
        rel = path.relative_to(ROOT)
        rel_posix = rel.as_posix()
        self._check_filename(path, rel, rel_posix)

        try:
            text, lines = GDFileCache.get(path)
        except Exception as exc:
            self.findings.append(
                Finding(
                    rule_id="ADV-TYP-001",
                    level="ERROR",
                    file_path=rel,
                    line_number=1,
                    message=f"文件编码或读取异常: {exc}",
                )
            )
            return

        self._check_domain_corruption(text, rel, rel_posix)
        self._check_pool_lifecycle_contract(text, lines, rel, rel_posix)

        loop_stack: list[int] = []
        for i, ln in enumerate(lines, 1):
            code_line = _strip_gd_comment(ln)
            stripped = code_line.strip()
            if not stripped:
                continue

            indent = len(ln) - len(ln.lstrip())
            self._update_loop_stack(ln, stripped, indent, loop_stack)
            self._check_var_decl(ln, i, rel, rel_posix)
            self._check_func_decl(ln, i, lines, rel, rel_posix)
            self._check_line_patterns(code_line, i, rel, rel_posix, loop_stack)


def _print_advanced_json_report(auditor: AdvancedCodeAuditor, files: list[Path], strict: bool) -> int:
    """输出 JSON 格式高级审查报告并返回退出码。"""
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


def _partition_findings(findings: list[Finding]) -> tuple[int, int, int]:
    """单趟统计 ERROR / WARN / INFO 计数 (ADV-PRF-002)。"""
    counts = {"ERROR": 0, "WARN": 0, "INFO": 0}
    for fd in findings:
        lvl = fd.level
        if lvl in counts:
            counts[lvl] += 1
    return counts["ERROR"], counts["WARN"], counts["INFO"]


def _print_finding_lines(findings: list[Finding]) -> None:
    """格式化打印单条审查发现。"""
    icon_map = {"ERROR": "❌", "WARN": "⚠️", "INFO": "ℹ️"}
    for fd in findings:
        icon = icon_map.get(fd.level, "ℹ️")
        print(f"  {icon} [{fd.rule_id}][{fd.level}] {fd.file_path}:{fd.line_number} — {fd.message}")
        if fd.fix_suggestion:
            print(f"     💡 修复建议: {fd.fix_suggestion}")


def _determine_advanced_verdict(n_errors: int, n_warns: int, strict: bool) -> bool:
    """判定门禁通过状态。"""
    if strict:
        return n_errors == 0 and n_warns == 0
    return n_errors == 0


def _print_advanced_console_report(auditor: AdvancedCodeAuditor, files: list[Path], strict: bool) -> int:
    """输出控制台看板格式报告并返回退出码。"""
    n_err, n_warn, n_info = _partition_findings(auditor.findings)

    print("=" * 80)
    print("🏛️ 卡拉尔世界引擎：GDScript 高级规范与质量治理审查 (Advanced Quality Gate)")
    print("=" * 80)
    print(f"  • 审查源文件总数: {len(files)} 个")
    print(f"  • 审查发现: ERROR {n_err} 项 | WARN {n_warn} 项 | INFO {n_info} 项")
    print("-" * 80)

    _print_finding_lines(auditor.findings)

    is_ok = _determine_advanced_verdict(n_err, n_warn, strict)
    print("=" * 80)
    if is_ok:
        print("【审查结论】通过（高级架构与强类型规范 100% 合规）")
        return 0
    print("【审查结论】未通过（存在高级代码质量阻断违规项）")
    return 1


def run_advanced_audit(strict: bool = False, json_output: bool = False, slice_name: str = "") -> int:
    """执行高级质量审查主循环。"""
    rules_data = get_rules_config()
    auditor = AdvancedCodeAuditor(rules_data)

    files = get_gd_files()
    if slice_name:
        files = [f for f in files if slice_name.lower() in f.as_posix().lower()]

    for f in files:
        auditor.audit_file(f)

    if json_output:
        return _print_advanced_json_report(auditor, files, strict)
    return _print_advanced_console_report(auditor, files, strict)
