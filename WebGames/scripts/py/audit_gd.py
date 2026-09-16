#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 代码规范门禁)
# 文件路径: WebGames/scripts/py/audit_gd.py
# 架构定位: 静态语法与性能审查器 (GDScript Linter & Guard)
# 依赖与触发: 触发方: CI / audit-all / 本地 CLI | 上游: backend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 扫描全域 GDScript 源码，强校验六字段题头、等宽集中分隔、禁用循环内瞬态分配与裸随机
# 退出语义与设计依据: 退出码: 0=合规, 1=存在阻断违规 | 设计依据: ADV-PRF-002 与后端注释统一规范
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_gd.py
#   python scripts/py/audit_gd.py --json
# ==============================================================================
"""审查 GDScript 编码规范、高级质量治理与简化防过度工程化（三节统一入口）。"""
import argparse
import functools
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from audit_common import ensure_utf8_stdout, resolve_repo_root
from audit_common import GD_LOOP_HEAD_RE

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG_RULES_FILE = ROOT / "scripts" / "config" / "code_governance_rules.json"

# 性能优化与审查收敛：文件表与规则表单例缓存（lru_cache 全进程单趟）。
# 原三节（Style/Advanced/Simplification）各自 rglob 全库 + json.loads 规则文件，
# 单进程内重复遍历 3 趟/重复解析 3 次；现收敛为各 1 趟，且与 --slice 过滤解耦。
@functools.lru_cache(maxsize=None)
def _gd_files(include_tests: bool = False) -> list:
    """全库 .gd 文件表单例缓存（含可选 tests 目录）。"""
    roots = [ROOT / "backend", ROOT / "frontend", ROOT / "benchmarks"]
    if include_tests:
        roots.append(ROOT / "tests")
    return sorted(p for r in roots for p in r.rglob("*.gd") if p.is_file())


@functools.lru_cache(maxsize=1)
def _rules_config() -> dict:
    """code_governance_rules.json 单例加载；缺失/解析失败返回空字典（语义与原逐节读取一致）。"""
    if not CONFIG_RULES_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_RULES_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[WARN] 无法读取规则文件 {CONFIG_RULES_FILE}: {e}", file=sys.stderr)
        return {}

# ---- 共享正则（Style 与 Advanced 共用）----
FILE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*\.gd$")
CLASS_NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9_]*$")
SNAKE_RE = re.compile(r"^_?[a-z][a-z0-9_]*$")
UPPER_RE = re.compile(r"^_?[A-Z][A-Z0-9_]*$")

# ---- Style 节预编译正则 ----
STYLE_CLASS_NAME_RE = re.compile(r"\bclass_name\s+([A-Za-z_][A-Za-z0-9_]*)")
STYLE_FUNC_RE = re.compile(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
STYLE_VAR_RE = re.compile(r"^\s*(?:static\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
STYLE_CONST_RE = re.compile(r"^\s*(?:static\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
PENDING_MARKER_RE = re.compile(r"#.*\b(TODO|FIXME|XXX|HACK)\b")

# ---- Advanced 节正则/规则集 ----
VAR_DECL_RE = re.compile(r"^\s*(?:static\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)")
FUNC_DECL_RE = re.compile(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)(?:\s*->\s*([A-Za-z0-9_\[\],\s.]+))?:")
LOOP_RE = GD_LOOP_HEAD_RE  # Phase 60：与 audit_perf_hotspots.py 同源（audit_common.GD_LOOP_HEAD_RE）
FORBIDDEN_EXTENDS_DOMAINS = {"Node", "Node2D", "Node3D", "Control", "CanvasItem", "Area2D", "CharacterBody2D"}
FORBIDDEN_RNG_CALLS = re.compile(r"(?<![.\w])(randf|randi|randomize|randf_range|randi_range|randfn)\s*\(")

# ---- Simplification 节正则/规则集（class_name 声明正则——与共享 CLASS_NAME_RE 同名不同义，改名 CLS_DECL_RE）----
CLS_DECL_RE = re.compile(r"^\s*class_name\s+([A-Za-z0-9_]+)")
EXTENDS_RE = re.compile(r"^\s*extends\s+([A-Za-z0-9_]+)")
FUNC_DEF_RE = re.compile(r"^\s*(?:static\s+)?func\s+([A-Za-z0-9_]+)\s*\(")
PASS_RE = re.compile(r"^\s*pass\s*(#.*)?$")


class GDFileCache:
    """全进程单趟 GDScript 文本与行切片内存缓存，消除跨节 4 趟重复读盘。"""
    _cache: Dict[Path, Tuple[str, List[str]]] = {}

    @classmethod
    def get(cls, path: Path) -> Tuple[str, List[str]]:
        res = cls._cache.get(path)
        if res is None:
            text = path.read_text(encoding="utf-8")
            res = (text, text.splitlines())
            cls._cache[path] = res
        return res


# =============================================================================
# Style 节（原 audit_gd_style.py）
# =============================================================================
HEADER_MUST = ("文件路径:", "职责")


def audit_file(path: Path, violations: list[str]) -> None:
    rel = path.relative_to(ROOT)
    if not FILE_NAME_RE.match(path.name):
        violations.append(f"{rel}: 文件名应为 snake_case（{path.name}）")
    try:
        text, lines = GDFileCache.get(path)
    except (UnicodeDecodeError, OSError) as e:
        violations.append(f"{rel}: 非 UTF-8 编码或读取失败（{e}）")
        return

    head = "\n".join(lines[:14])
    # 单机聚焦：tests 为用例集合，不强制 文件路径/职责 头（生产代码 backend/frontend/benchmarks 仍强制）
    rel_posix = rel.as_posix()
    if not rel_posix.startswith("tests/"):
        for marker in HEADER_MUST:
            if marker not in head:
                violations.append(f"{rel}: 文件头缺少「{marker}」注释")
    if "GameConfig.get_value(" in text:
        violations.append(f"{rel}: 禁止外部调用 GameConfig.get_value（返回 Variant 触发警告即错误）")

    for i, ln in enumerate(lines, 1):
        m = STYLE_CLASS_NAME_RE.search(ln)
        if m and not CLASS_NAME_RE.match(m.group(1)):
            violations.append(f"{rel}:{i}: class_name 应为 PascalCase（{m.group(1)}）")
        m = STYLE_FUNC_RE.search(ln)
        if m and not SNAKE_RE.match(m.group(1)):
            violations.append(f"{rel}:{i}: 函数名应为 snake_case（{m.group(1)}）")
        m = STYLE_VAR_RE.search(ln)
        if m and not SNAKE_RE.match(m.group(1)):
            violations.append(f"{rel}:{i}: 变量名应为 snake_case（{m.group(1)}）")
        m = STYLE_CONST_RE.search(ln)
        if m:
            name = m.group(1)
            if "preload(" in ln:
                if not CLASS_NAME_RE.match(name):
                    violations.append(f"{rel}:{i}: preload 常量引用应为 PascalCase（{name}）")
            elif not UPPER_RE.match(name):
                violations.append(f"{rel}:{i}: 常量应为 UPPER_SNAKE_CASE（{name}）")
        # COMMENT-PENDING-MARKER：生产代码注释禁止显式未决标记（TODO/FIXME/XXX/HACK 整词匹配），
        # 未决事项须收敛为既有 Phase 编号追踪或移除；中文业务术语（占位符/临时物件/临时升格等）不受影响。
        pm = PENDING_MARKER_RE.search(ln)
        if pm and not rel_posix.startswith("tests/"):
            violations.append(f"{rel}:{i}: 注释含未决标记「{pm.group(1)}」——收敛为 Phase 编号追踪或移除（COMMENT-PENDING-MARKER）")


def run_style_audit(include_tests: bool = False) -> int:
    files = _gd_files(include_tests)

    violations: list[str] = []
    for f in files:
        audit_file(f, violations)

    print(f"【audit-gd-style】审查文件: {len(files)} 个")
    if violations:
        print("【audit-gd-style】违规项:")
        for v in violations:
            print(f"  ✗ {v}")
        print("【审查结论】未通过")
        return 1
    print("【审查结论】通过")
    return 0

# =============================================================================
# Advanced 节（原 audit_gd_advanced.py）
# =============================================================================
@dataclass
class Finding:
    rule_id: str
    level: str  # ERROR, WARN, INFO
    file_path: Path
    line_number: int
    message: str
    fix_suggestion: str = ""


class AdvancedCodeAuditor:
    def __init__(self, rules_data: dict) -> None:
        self.rules_config = rules_data.get("advanced_rules", {})
        self.exemptions = rules_data.get("exemptions", {})
        self.findings: List[Finding] = []

    def is_exempt(self, rule_id: str, file_rel_posix: str) -> bool:
        """检查特定文件是否豁免某条规则"""
        by_file = self.exemptions.get("by_file", {})
        if file_rel_posix in by_file and rule_id in by_file[file_rel_posix]:
            return True

        by_prefix = self.exemptions.get("by_path_prefix", {})
        for prefix, rule_list in by_prefix.items():
            if file_rel_posix.startswith(prefix) and rule_id in rule_list:
                return True
        return False

    def audit_file(self, path: Path) -> None:
        rel = path.relative_to(ROOT)
        rel_posix = rel.as_posix()

        # 文件名规范
        if not FILE_NAME_RE.match(path.name) and not self.is_exempt("ADV-NAM-001", rel_posix):
            rule = self.rules_config.get("ADV-NAM-001", {})
            self.findings.append(Finding(
                rule_id="ADV-NAM-001",
                level=rule.get("level", "ERROR"),
                file_path=rel,
                line_number=1,
                message=f"文件名「{path.name}」不符合 snake_case 命名规范",
                fix_suggestion="重命名为小写下划线格式（如 item_service.gd）"
            ))

        try:
            text, lines = GDFileCache.get(path)
        except Exception as e:
            self.findings.append(Finding(
                rule_id="ADV-TYP-001",
                level="ERROR",
                file_path=rel,
                line_number=1,
                message=f"文件编码或读取异常: {e}"
            ))
            return

        # 检查领域模型防腐性 (ADV-DEC-001)
        if rel_posix.startswith("backend/domains/") and not self.is_exempt("ADV-DEC-001", rel_posix):
            m_ext = re.search(r"^\s*extends\s+([A-Za-z0-9_]+)", text, re.MULTILINE)
            if m_ext:
                base_class = m_ext.group(1)
                if base_class in FORBIDDEN_EXTENDS_DOMAINS:
                    rule = self.rules_config.get("ADV-DEC-001", {})
                    self.findings.append(Finding(
                        rule_id="ADV-DEC-001",
                        level=rule.get("level", "ERROR"),
                        file_path=rel,
                        line_number=text[:m_ext.start()].count("\n") + 1,
                        message=f"后端纯领域模型类严禁继承场景树节点「{base_class}」",
                        fix_suggestion=rule.get("fix_suggestion", "将基类改为 RefCounted 或 Object")
                    ))

        # 逐行审查
        loop_stack: List[int] = []

        for i, ln in enumerate(lines, 1):
            code_line = ln.split("#")[0].rstrip()
            stripped = code_line.strip()
            if not stripped:
                continue

            indent = len(ln) - len(ln.lstrip())

            # 跟踪循环栈 (ADV-PRF-001)
            if LOOP_RE.match(ln):
                while loop_stack and loop_stack[-1] >= indent:
                    loop_stack.pop()
                loop_stack.append(indent)
            elif loop_stack and indent <= loop_stack[-1] and not stripped.startswith(("else", "elif")):
                while loop_stack and loop_stack[-1] >= indent:
                    loop_stack.pop()

            # 1. 变量声明强类型检查 (ADV-TYP-001) 与命名 (ADV-NAM-001)
            m_var = VAR_DECL_RE.match(ln)
            if m_var:
                var_name = m_var.group(1)
                # 命名检查
                if not SNAKE_RE.match(var_name) and not self.is_exempt("ADV-NAM-001", rel_posix):
                    rule = self.rules_config.get("ADV-NAM-001", {})
                    self.findings.append(Finding(
                        rule_id="ADV-NAM-001",
                        level=rule.get("level", "ERROR"),
                        file_path=rel,
                        line_number=i,
                        message=f"变量名「{var_name}」不符合 snake_case 规范",
                        fix_suggestion=rule.get("fix_suggestion", "")
                    ))

                # 强类型检查: 避免弱类型 var x = 1（应为 var x: int = 1 或 var x := 1）
                if not self.is_exempt("ADV-TYP-001", rel_posix):
                    after_var = ln[m_var.end():].strip()
                    if after_var.startswith("="):
                        rule = self.rules_config.get("ADV-TYP-001", {})
                        self.findings.append(Finding(
                            rule_id="ADV-TYP-001",
                            level=rule.get("level", "WARN"),
                            file_path=rel,
                            line_number=i,
                            message=f"变量「{var_name}」采用隐式弱类型分配（var =），建议使用显式声明 (: Type =) 或推断 (:=)",
                            fix_suggestion=f"改用 `var {var_name} := ...` 或指定具体类型 `var {var_name}: Type = ...`"
                        ))
                    elif not after_var.startswith(":") and not after_var.startswith("("):
                        # 裸 var x 无类型无初始值
                        rule = self.rules_config.get("ADV-TYP-001", {})
                        self.findings.append(Finding(
                            rule_id="ADV-TYP-001",
                            level=rule.get("level", "WARN"),
                            file_path=rel,
                            line_number=i,
                            message=f"变量「{var_name}」缺少显式类型标注",
                            fix_suggestion=f"显式补充类型注解，如 `var {var_name}: String`"
                        ))

            # 2. 函数声明类型完整性 (ADV-TYP-002) 与命名（支持跨行签名累积）
            m_func_start = re.match(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", ln)
            if m_func_start:
                accum_sig = ln.split("#")[0].strip()
                look_idx = i  # lines is 0-indexed, so lines[look_idx] is line i+1
                while look_idx < len(lines) and not re.search(r"\)\s*(?:->\s*[^:]+)?\s*:", accum_sig):
                    next_sig_ln = lines[look_idx].split("#")[0].strip()
                    accum_sig += " " + next_sig_ln
                    look_idx += 1
                m_func = FUNC_DECL_RE.match(accum_sig)
                if not m_func:
                    m_func = re.match(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)(?:\s*->\s*([A-Za-z0-9_\[\],\s.]+))?:", accum_sig)
                if m_func:
                    func_name = m_func.group(1)
                    params_str = m_func.group(2).strip()
                    ret_type = m_func.group(3)

                if not SNAKE_RE.match(func_name) and not self.is_exempt("ADV-NAM-001", rel_posix):
                    rule = self.rules_config.get("ADV-NAM-001", {})
                    self.findings.append(Finding(
                        rule_id="ADV-NAM-001",
                        level=rule.get("level", "ERROR"),
                        file_path=rel,
                        line_number=i,
                        message=f"函数名「{func_name}」不符合 snake_case 规范"
                    ))

                # 参数类型完整性检查
                if params_str and not self.is_exempt("ADV-TYP-002", rel_posix):
                    params = [p.strip() for p in params_str.split(",") if p.strip()]
                    for p in params:
                        # 排除可变参数 vararg 或合规注解 p_name: Type
                        if not re.search(r"[:=]", p):
                            rule = self.rules_config.get("ADV-TYP-002", {})
                            self.findings.append(Finding(
                                rule_id="ADV-TYP-002",
                                level=rule.get("level", "ERROR"),
                                file_path=rel,
                                line_number=i,
                                message=f"函数「{func_name}」参数「{p}」缺少显式类型注解",
                                fix_suggestion="为参数补充强类型，如 p_param: int"
                            ))

            # 3. 确定性随机沙盒 (ADV-RNG-001)
            if FORBIDDEN_RNG_CALLS.search(code_line) and not self.is_exempt("ADV-RNG-001", rel_posix):
                rule = self.rules_config.get("ADV-RNG-001", {})
                self.findings.append(Finding(
                    rule_id="ADV-RNG-001",
                    level=rule.get("level", "ERROR"),
                    file_path=rel,
                    line_number=i,
                    message="严禁调用 Godot 全局非确定性随机函数（randf/randi/randomize）",
                    fix_suggestion=rule.get("fix_suggestion", "使用 DeterministicRNG 替代")
                ))

            # 4. 配置读取禁令 (ADV-CFG-001)
            if "GameConfig.get_value(" in code_line and not self.is_exempt("ADV-CFG-001", rel_posix):
                rule = self.rules_config.get("ADV-CFG-001", {})
                self.findings.append(Finding(
                    rule_id="ADV-CFG-001",
                    level=rule.get("level", "ERROR"),
                    file_path=rel,
                    line_number=i,
                    message="禁止外部调用 GameConfig.get_value（返回无类型 Variant）",
                    fix_suggestion="改用类型化读取方法：get_int / get_float / get_string / get_dict / get_array"
                ))

            # 5. 循环内配置读取性能警告 (ADV-PRF-001)
            if loop_stack and "GameConfig.get_" in code_line and not self.is_exempt("ADV-PRF-001", rel_posix):
                rule = self.rules_config.get("ADV-PRF-001", {})
                self.findings.append(Finding(
                    rule_id="ADV-PRF-001",
                    level=rule.get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="循环体内重复读取 GameConfig 配置，属于热点性能隐患",
                    fix_suggestion="将配置读取提取至循环体外作为局部常量/变量缓存"
                ))

            # 6. 跨域私有访问禁令 (ADV-BND-001)
            if rel_posix.startswith("backend/domains/") and not self.is_exempt("ADV-BND-001", rel_posix):
                m_priv = re.search(r"(?<!\bself)(?<!\bsuper)\b([a-z][a-z0-9_]*_(?:service|manager|engine|pipeline))\._([a-z][a-z0-9_]+)\b", code_line)
                if m_priv:
                    target_obj, target_priv = m_priv.group(1), m_priv.group(2)
                    rule = self.rules_config.get("ADV-BND-001", {})
                    self.findings.append(Finding(
                        rule_id="ADV-BND-001",
                        level=rule.get("level", "ERROR"),
                        file_path=rel,
                        line_number=i,
                        message=f"跨对象直接访问私有成员「{target_obj}._{target_priv}」，破坏领域防腐封装",
                        fix_suggestion=rule.get("fix_suggestion", "改用公开 API 方法或通过事件解耦交互")
                    ))

            # 7. Lambda 捕获与闭包安全 (ADV-LAM-001)
            if "func(" in code_line and not code_line.startswith("func ") and not code_line.startswith("static func ") and not self.is_exempt("ADV-LAM-001", rel_posix):
                rule = self.rules_config.get("ADV-LAM-001", {})
                if re.search(r"\bvar\s+_\w+\s*=", code_line):
                    self.findings.append(Finding(
                        rule_id="ADV-LAM-001",
                        level=rule.get("level", "WARN"),
                        file_path=rel,
                        line_number=i,
                        message="Lambda 表达式中声明或修改捕获变量，可能存在生命周期与值拷贝安全隐患",
                        fix_suggestion=rule.get("fix_suggestion", "使用 Callable 或将状态封装于 RefCounted 容器中")
                    ))

            # 8. 盲目推断 Variant (ADV-TYP-003)
            if re.search(r"^\s*var\s+[a-zA-Z0-9_]+\s*:=\s*[a-zA-Z0-9_]+\.(?:get|pop_front|pop_back)\s*\(", code_line) and not self.is_exempt("ADV-TYP-003", rel_posix):
                rule = self.rules_config.get("ADV-TYP-003", {})
                self.findings.append(Finding(
                    rule_id="ADV-TYP-003",
                    level=rule.get("level", "WARN"),
                    file_path=rel,
                    line_number=i,
                    message="对动态容器返回值使用 := 盲目推断为 Variant，隐藏类型缺陷",
                    fix_suggestion=rule.get("fix_suggestion", "显式声明类型并增加空值卫语句守卫")
                ))

            # 9. 信号发射参数完整性 (ADV-SIG-001)
            if ("emit_signal(" in code_line or ".emit(" in code_line) and not self.is_exempt("ADV-SIG-001", rel_posix):
                rule = self.rules_config.get("ADV-SIG-001", {})
                if re.search(r"\.emit\(\s*null\s*\)", code_line):
                    self.findings.append(Finding(
                        rule_id="ADV-SIG-001",
                        level=rule.get("level", "ERROR"),
                        file_path=rel,
                        line_number=i,
                        message="信号发射传参裸传 null，可能引发接收方空指针解构崩溃",
                        fix_suggestion=rule.get("fix_suggestion", "核对信号声明签名并确保发射传参一一对应")
                    ))

def run_advanced_audit(strict: bool = False, json_output: bool = False, slice_name: str = "") -> int:
    rules_data = _rules_config()

    auditor = AdvancedCodeAuditor(rules_data)

    files = _gd_files()
    if slice_name:
        files = [f for f in files if slice_name.lower() in f.as_posix().lower()]

    for f in files:
        auditor.audit_file(f)

    errors = [fd for fd in auditor.findings if fd.level == "ERROR"]
    warns = [fd for fd in auditor.findings if fd.level == "WARN"]
    infos = [fd for fd in auditor.findings if fd.level == "INFO"]

    if json_output:
        res = {
            "total_files": len(files),
            "errors": len(errors),
            "warns": len(warns),
            "infos": len(infos),
            "passed": len(errors) == 0 and (not strict or len(warns) == 0),
            "findings": [
                {
                    "rule_id": fd.rule_id,
                    "level": fd.level,
                    "file": str(fd.file_path),
                    "line": fd.line_number,
                    "message": fd.message,
                    "suggestion": fd.fix_suggestion
                } for fd in auditor.findings
            ]
        }
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res["passed"] else 1

    print("=" * 80)
    print("🏛️ 卡拉尔世界引擎：GDScript 高级规范与质量治理审查 (Advanced Quality Gate)")
    print("=" * 80)
    print(f"  • 审查源文件总数: {len(files)} 个")
    print(f"  • 审查发现: ERROR {len(errors)} 项 | WARN {len(warns)} 项 | INFO {len(infos)} 项")
    print("-" * 80)

    if auditor.findings:
        for fd in auditor.findings:
            icon = "❌" if fd.level == "ERROR" else ("⚠️" if fd.level == "WARN" else "ℹ️")
            print(f"  {icon} [{fd.rule_id}][{fd.level}] {fd.file_path}:{fd.line_number} — {fd.message}")
            if fd.fix_suggestion:
                print(f"     💡 修复建议: {fd.fix_suggestion}")

    is_ok = (len(errors) == 0) if not strict else (len(errors) == 0 and len(warns) == 0)
    print("=" * 80)
    if is_ok:
        print("【审查结论】通过（高级架构与强类型规范 100% 合规）")
        return 0
    else:
        print("【审查结论】未通过（存在高级代码质量阻断违规项）")
        return 1

# =============================================================================
# Simplification 节（原 audit_gd_simplification.py）
# =============================================================================
@dataclass
class SimplificationFinding:
    rule_id: str
    level: str  # ERROR, WARN, INFO
    file_path: Path
    line_number: int
    message: str
    fix_suggestion: str = ""


class SimplificationAuditor:
    def __init__(self, rules_data: dict) -> None:
        self.rules_config = rules_data.get("simplification_rules", {})
        self.exemptions = rules_data.get("exemptions", {})
        self.findings: List[SimplificationFinding] = []
        self.class_hierarchy: Dict[str, str] = {}  # ClassName -> BaseClassName
        self.class_to_file: Dict[str, Path] = {}

    def is_exempt(self, rule_id: str, file_rel_posix: str) -> bool:
        by_file = self.exemptions.get("by_file", {})
        if file_rel_posix in by_file and rule_id in by_file[file_rel_posix]:
            return True

        by_prefix = self.exemptions.get("by_path_prefix", {})
        for prefix, rule_list in by_prefix.items():
            if file_rel_posix.startswith(prefix) and rule_id in rule_list:
                return True
        return False

    def build_hierarchy_map(self, files: List[Path]) -> None:
        """预先构建类继承拓扑字典（复用单趟 GDFileCache 内存缓存）"""
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
            except Exception:
                pass

    def get_inheritance_depth(self, class_name: str, visited: Optional[Set[str]] = None) -> int:
        """递归计算继承链深度"""
        if visited is None:
            visited = set()
        if class_name in visited:
            return 0  # 避免环形依赖
        visited.add(class_name)

        base = self.class_hierarchy.get(class_name)
        if not base or base in {"RefCounted", "Object", "Node", "Control", "Resource", "Node2D"}:
            return 1
        if base in self.class_hierarchy:
            return 1 + self.get_inheritance_depth(base, visited)
        return 2

    def audit_inheritance_depth(self) -> None:
        """SIM-INH-001: 校验继承深度（≤ 2 层）"""
        rule = self.rules_config.get("SIM-INH-001", {})
        level = rule.get("level", "ERROR")

        for cname, f in self.class_to_file.items():
            rel = f.relative_to(ROOT)
            rel_posix = rel.as_posix()
            if self.is_exempt("SIM-INH-001", rel_posix):
                continue

            depth = self.get_inheritance_depth(cname)
            if depth > 2:
                self.findings.append(SimplificationFinding(
                    rule_id="SIM-INH-001",
                    level=level,
                    file_path=rel,
                    line_number=1,
                    message=f"类「{cname}」继承深度达 {depth} 层（超过上限 2 层），存在过度继承风险",
                    fix_suggestion=rule.get("fix_suggestion", "将深层继承树重构为平铺领域类 + 组合策略模式")
                ))

    def audit_file_content(self, path: Path) -> None:
        rel = path.relative_to(ROOT)
        rel_posix = rel.as_posix()

        try:
            text, lines = GDFileCache.get(path)
        except Exception:
            return

        func_count = 0
        single_forward_count = 0
        in_func = False
        func_start_line = 0
        func_name = ""
        func_lines: List[Tuple[int, str]] = []
        nesting_depth = 0
        max_func_nesting = 0

        for i, ln in enumerate(lines, 1):
            code_line = ln.split("#")[0].rstrip()
            stripped = code_line.strip()
            if not stripped:
                continue

            indent = len(ln) - len(ln.lstrip())

            # 1. 检查无意义的 pass 冗余 (SIM-DED-001)
            if PASS_RE.match(ln) and not self.is_exempt("SIM-DED-001", rel_posix):
                # 如果当前函数/块中除了 pass 还有其他代码行，则 pass 是死代码
                # 或者在已有 return/assignment 后紧跟 pass
                if i > 1:
                    prev_code = lines[i - 2].split("#")[0].strip()
                    if prev_code and not prev_code.endswith(":") and not prev_code.startswith(("func", "class", "if", "else", "elif", "for", "while", "match")):
                        rule = self.rules_config.get("SIM-DED-001", {})
                        self.findings.append(SimplificationFinding(
                            rule_id="SIM-DED-001",
                            level=rule.get("level", "WARN"),
                            file_path=rel,
                            line_number=i,
                            message="在已执行语句后检测到多余冗余的「pass」语句",
                            fix_suggestion="直接删除无效的 pass 行"
                        ))

            # 2. 检查布尔冗余返回 (SIM-DED-001: if cond: return true/false else: return false/true)
            if ("return true" in stripped.lower() or "return false" in stripped.lower()) and not self.is_exempt("SIM-DED-001", rel_posix):
                target_bool = "return false" if "return true" in stripped.lower() else "return true"
                # 向后寻找下一个有效代码行
                j = i  # i 是 1-based，对应 lines 的下标为 i (即下一行)
                while j < len(lines) and not lines[j].split("#")[0].strip():
                    j += 1
                if j < len(lines) and lines[j].split("#")[0].strip().startswith("else"):
                    k = j + 1
                    while k < len(lines) and not lines[k].split("#")[0].strip():
                        k += 1
                    if k < len(lines) and target_bool in lines[k].split("#")[0].strip().lower():
                        rule = self.rules_config.get("SIM-DED-001", {})
                        self.findings.append(SimplificationFinding(
                            rule_id="SIM-DED-001",
                            level=rule.get("level", "WARN"),
                            file_path=rel,
                            line_number=i,
                            message="检测到冗余布尔三元分支（if ...: return true/false else: return false/true）",
                            fix_suggestion="直接返回条件表达式布尔值：return <condition> 或 return not <condition>"
                        ))

            # 3. 函数控制流嵌套深度 (SIM-CMP-001)
            m_fn = FUNC_DEF_RE.match(ln)
            if m_fn:
                # 结算上一个函数
                if in_func and max_func_nesting > 5 and not self.is_exempt("SIM-CMP-001", rel_posix):
                    rule = self.rules_config.get("SIM-CMP-001", {})
                    self.findings.append(SimplificationFinding(
                        rule_id="SIM-CMP-001",
                        level=rule.get("level", "WARN"),
                        file_path=rel,
                        line_number=func_start_line,
                        message=f"函数「{func_name}」控制流最大嵌套深度达 {max_func_nesting} 层（超限 5 层），认知负荷过高",
                        fix_suggestion="采用卫语句（Guard Clauses）前置校验早期返回，或提炼子求解器函数"
                    ))

                in_func = True
                func_start_line = i
                func_name = m_fn.group(1)
                func_lines = []
                func_count += 1
                nesting_depth = 0
                max_func_nesting = 0
            elif in_func:
                if indent == 0 and not stripped.startswith("#"):
                    in_func = False
                else:
                    if stripped.startswith(("if ", "for ", "while ", "match ", "elif ", "else:")):
                        # 粗略估算缩进嵌套层级
                        current_nesting = indent // 4 if "\t" not in ln[:indent] else len(ln[:indent].replace("    ", "\t"))
                        if current_nesting > max_func_nesting:
                            max_func_nesting = current_nesting
                    func_lines.append((i, stripped))

        # 结算最后一个函数的控制流嵌套深度 (SIM-CMP-001)
        if in_func and max_func_nesting > 5 and not self.is_exempt("SIM-CMP-001", rel_posix):
            rule = self.rules_config.get("SIM-CMP-001", {})
            self.findings.append(SimplificationFinding(
                rule_id="SIM-CMP-001",
                level=rule.get("level", "WARN"),
                file_path=rel,
                line_number=func_start_line,
                message=f"函数「{func_name}」控制流最大嵌套深度达 {max_func_nesting} 层（超限 5 层），认知负荷过高",
                fix_suggestion="采用卫语句（Guard Clauses）前置校验早期返回，或提炼子求解器函数"
            ))

        # 4. 检查空包装类/转发类 (SIM-WRP-001)
        if func_count == 1 and not self.is_exempt("SIM-WRP-001", rel_posix):
            # 如果类仅有 1 个方法且只有 1-2 行调用转发
            non_empty_code_lines = [ln for _, ln in func_lines if ln and not ln.startswith(("#", "var ", "const "))]
            if len(non_empty_code_lines) == 1 and non_empty_code_lines[0].startswith("return ") and "." in non_empty_code_lines[0]:
                rule = self.rules_config.get("SIM-WRP-001", {})
                self.findings.append(SimplificationFinding(
                    rule_id="SIM-WRP-001",
                    level=rule.get("level", "WARN"),
                    file_path=rel,
                    line_number=1,
                    message="类中仅包含单行透传方法，疑似无实际业务增值的空包装/代理层",
                    fix_suggestion="评估是否可直接消费底层服务，或将此中间类内联简化"
                ))

def run_simplification_audit(strict: bool = False, json_output: bool = False, slice_name: str = "") -> int:
    rules_data = _rules_config()

    auditor = SimplificationAuditor(rules_data)

    files = _gd_files()
    if slice_name:
        files = [f for f in files if slice_name.lower() in f.as_posix().lower()]

    auditor.build_hierarchy_map(files)
    auditor.audit_inheritance_depth()

    for f in files:
        auditor.audit_file_content(f)

    errors = [fd for fd in auditor.findings if fd.level == "ERROR"]
    warns = [fd for fd in auditor.findings if fd.level == "WARN"]
    infos = [fd for fd in auditor.findings if fd.level == "INFO"]

    if json_output:
        res = {
            "total_files": len(files),
            "errors": len(errors),
            "warns": len(warns),
            "infos": len(infos),
            "passed": len(errors) == 0 and (not strict or len(warns) == 0),
            "findings": [
                {
                    "rule_id": fd.rule_id,
                    "level": fd.level,
                    "file": str(fd.file_path),
                    "line": fd.line_number,
                    "message": fd.message,
                    "suggestion": fd.fix_suggestion
                } for fd in auditor.findings
            ]
        }
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res["passed"] else 1

    print("=" * 80)
    print("✂️ 卡拉尔世界引擎：代码简化与防过度工程化审查 (Simplification Gate)")
    print("=" * 80)
    print(f"  • 审查源文件总数: {len(files)} 个")
    print(f"  • 审查发现: ERROR {len(errors)} 项 | WARN {len(warns)} 项 | INFO {len(infos)} 项")
    print("-" * 80)

    if auditor.findings:
        for fd in auditor.findings:
            icon = "❌" if fd.level == "ERROR" else ("⚠️" if fd.level == "WARN" else "ℹ️")
            print(f"  {icon} [{fd.rule_id}][{fd.level}] {fd.file_path}:{fd.line_number} — {fd.message}")
            if fd.fix_suggestion:
                print(f"     💡 简化建议: {fd.fix_suggestion}")

    is_ok = (len(errors) == 0) if not strict else (len(errors) == 0 and len(warns) == 0)
    print("=" * 80)
    if is_ok:
        print("【审查结论】通过（架构复杂度收敛于最小充分复杂度，无过度堆砌）")
        return 0
    else:
        print("【审查结论】未通过（存在过度工程化或冗余代码）")
        return 1

# =============================================================================
# 规则配置覆盖率自校验（H1 审查修复）
# =============================================================================
# 抽取本文件代码中 .get("RULE_ID") 形式的规则消费点，与 code_governance_rules.json
# 声明键双向差集：悬空引用（config 缺失代码所需规则 → 静默取空放行）阻断；
# 声明未实施（config 已声明但代码无消费点）提示——杜绝「config 承诺治理 N 条、
# 实际仅审 M 条」的隐性结构预期缺口。
RULE_GET_CALL_RE = re.compile(r'\.get\("((?:ADV|SIM)-[A-Z0-9-]+)"')


def verify_rule_config_coverage() -> int:
    """规则配置覆盖率自检：悬空引用返回 1（阻断），声明未实施仅提示（返回 0）。"""
    try:
        src = Path(__file__).read_text(encoding="utf-8")
    except OSError:
        return 0
    consumed = {m.group(1) for m in RULE_GET_CALL_RE.finditer(src)}
    if not consumed:
        return 0

    declared: set = set()
    if CONFIG_RULES_FILE.exists():
        try:
            data = json.loads(CONFIG_RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return 0
        for section in ("advanced_rules", "simplification_rules"):
            declared.update(str(k) for k in (data.get(section, {}) or {}).keys())

    dangling = sorted(consumed - declared)
    unimplemented = sorted(declared - consumed)
    if not dangling and not unimplemented:
        return 0

    print("=" * 80)
    print("🧩 规则配置覆盖率自检（H1：code_governance_rules.json 键 ↔ 代码消费点）")
    if dangling:
        print(f"  ❌ 悬空引用 {len(dangling)} 项（config 缺失该键，规则将静默失效并放行）: {', '.join(dangling)}")
    if unimplemented:
        print(f"  ⚠️ 声明未实施 {len(unimplemented)} 项（config 已声明但代码无消费点）: {', '.join(unimplemented)}")
    print("-" * 80)
    return 1 if dangling else 0


# =============================================================================
# 统一 main（三节聚合入口）
# =============================================================================
def main() -> int:
    ap = argparse.ArgumentParser(description="GDScript 质量治理统一审查（Style + Advanced + Simplification）")
    ap.add_argument("--all", action="store_true", help="Style 节包含 tests/ 目录")
    ap.add_argument("--strict", action="store_true", help="将警告视为错误并阻断")
    ap.add_argument("--json", action="store_true", help="输出 JSON 格式聚合报告（Advanced/Simplification 节）")
    ap.add_argument("--slice", type=str, default="", help="仅审查匹配特定域名的文件")
    args = ap.parse_args()

    exit_codes: List[int] = []
    # H1 审查修复：规则配置覆盖率自检先行（悬空引用即阻断，防规则静默失效）
    exit_codes.append(verify_rule_config_coverage())
    exit_codes.append(run_style_audit(include_tests=args.all))
    exit_codes.append(run_advanced_audit(strict=args.strict, json_output=args.json, slice_name=args.slice))
    exit_codes.append(run_simplification_audit(strict=args.strict, json_output=args.json, slice_name=args.slice))
    return 1 if any(c != 0 for c in exit_codes) else 0


if __name__ == "__main__":
    sys.exit(main())


