#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 脚本库规范门禁)
# 文件路径: WebGames/scripts/py/audit_script_comment.py
# 架构定位: 脚本库全域题头与严格规范化守卫 (Script Header & Strictness Guard)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: 全域 74 份活动脚本 | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 扫描全域 74 份脚本，强力断言后端六字段题头、文件真实路径匹配、78 字符等宽线、零批次黑话、PowerShell 三件套、Bash 安全选项与 Python 强类型契约
# 退出语义与设计依据: 退出码: 0=全域脚本合规, 1=存在违规 | 设计依据: 脚本库严格工程化标准契约与 AGENTS.md
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_script_comment.py
#   python scripts/py/audit_script_comment.py --json
#   python scripts/py/audit_script_comment.py --fix
# ==============================================================================
"""audit_script_comment.py — 脚本库全域头注释与质量门禁审查引擎。

覆盖全域 74 份活动脚本（sh/ps1/py/mjs），全方位实施泛化静态代码审查：
1. 后端六字段标准与非空校验（模块归属/文件路径/架构定位/依赖与触发/职责说明/退出语义与设计依据）；
2. 文件路径真实性对齐断言（声明路径与仓库相对物理路径 100% 一致）；
3. 78 字符等宽集中分隔线；
4. 未决标记（TODO/FIXME/XXX/HACK）与施工批次黑话（pXX/phaseXX/stXX/wip）零容忍；
5. PowerShell 标头三件套（[CmdletBinding()]、Set-StrictMode -Version Latest、$ErrorActionPreference）；
6. Bash 安全 Shebang（#!/usr/bin/env bash）与安全选项（set -uo pipefail，禁用盲目 set -e）；
7. Python 100% 强类型注解覆盖、零裸 except 违规与 AST 注解引用名字绑定完备性。
"""

import argparse
import ast
import json
import re
import sys
from pathlib import Path
from typing import Any, Generator

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()

# 全域扫描目标目录（覆盖 WebGames 与根目录脚本库全域 74 份文件）
SCAN_ROOTS = [
    ROOT / "scripts",
    ROOT.parent / "scripts",
]

HEADER_MUST = (
    "模块归属:",
    "文件路径:",
    "架构定位:",
    "依赖与触发:",
    "职责说明:",
    "退出语义与设计依据:",
)

PENDING_RE = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b")
JARGON_RE = re.compile(r"\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|wip)\b", re.IGNORECASE)
SEP_RE = re.compile(r"^#\s*(=+|-+)\s*$")
JS_SEP_RE = re.compile(r"^//\s*(=+|-+)\s*$")
PS1_EA_RE = re.compile(r"\$ErrorActionPreference\s*=\s*['\"](Stop|Continue)['\"]")


def iter_targets() -> Generator[Path, None, None]:
    """遍历全域 74 份活动脚本文件。"""
    seen: set[Path] = set()
    for base in SCAN_ROOTS:
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            if any(part in p.parts for part in ("node_modules", ".auto-refactor-cache", "__pycache__")):
                continue
            if p.suffix in (".py", ".sh", ".ps1", ".mjs"):
                resolved = p.resolve()
                if resolved not in seen:
                    seen.add(resolved)
                    yield p


def audit_file(path: Path, fix: bool = False) -> list[dict[str, Any]]:
    """解析单文件头注释与严格工程化规则，返回违规 dict 列表。"""
    violations: list[dict[str, Any]] = []
    path = path.resolve()
    try:
        raw_bytes = path.read_bytes()
        text = raw_bytes.decode("utf-8", errors="ignore")
    except Exception as e:
        return [{
            "file": str(path),
            "rule": "HEADER-UNREADABLE",
            "detail": f"无法读取文件（编码/IO: {e}）"
        }]

    lines = text.splitlines()
    head_lines = lines[:35]
    head = "\n".join(head_lines)

    # 1. 必填六字段及非空校验
    for marker in HEADER_MUST:
        if marker not in head:
            violations.append({
                "file": str(path),
                "rule": "HEADER-MISSING-MUST",
                "detail": f"缺少必填六字段要素「{marker}」"
            })
        else:
            for line in head_lines:
                if marker in line:
                    val = line.split(marker, 1)[1].strip()
                    if not val:
                        violations.append({
                            "file": str(path),
                            "rule": "HEADER-EMPTY-FIELD",
                            "detail": f"要素「{marker}」内容为空"
                        })
                    break

    # 1b. 文件路径真实性对齐
    for line in head_lines:
        if "文件路径:" in line:
            decl_path = line.split("文件路径:", 1)[1].strip().replace("\\", "/")
            repo_parent = ROOT.parent if (ROOT.parent / "scripts").exists() else ROOT
            rel_repo = str(path.relative_to(repo_parent)).replace("\\", "/")
            rel_wg = str(path.relative_to(ROOT)).replace("\\", "/") if path.is_relative_to(ROOT) else None
            valid_paths = {rel_repo}
            if rel_wg:
                valid_paths.add(rel_wg)
                valid_paths.add(f"WebGames/{rel_wg}")
            if decl_path not in valid_paths:
                violations.append({
                    "file": str(path),
                    "rule": "HEADER-PATH-MISMATCH",
                    "detail": f"声明路径「{decl_path}」与物理路径「{rel_repo}」不符"
                })
            break

    # 2. 78 字符等宽分隔线检查（去 # 或 // 后，符号数量必须恰好为 78）
    fixed = False
    new_lines = list(lines)
    is_js = path.suffix == ".mjs"

    for i, line in enumerate(head_lines):
        sep_matched = False
        prefix = "# "
        sym = "="

        if is_js:
            m = JS_SEP_RE.match(line)
            if m:
                sep_matched = True
                prefix = "// "
                sym = m.group(1)[0]
        else:
            m = SEP_RE.match(line)
            if m:
                sep_matched = True
                prefix = "# "
                sym = m.group(1)[0]

        if sep_matched and m:
            width = len(m.group(1))
            if width != 78:
                violations.append({
                    "file": str(path),
                    "rule": "HEADER-SEPARATOR-WIDTH",
                    "detail": f"L{i+1} 分隔线宽度 {width} ≠ 78"
                })
                if fix:
                    new_lines[i] = prefix + (sym * 78)
                    fixed = True

    if fix and fixed:
        new_text = "\n".join(new_lines)
        if path.suffix == ".ps1":
            new_text = new_text.replace("\r\n", "\n").replace("\n", "\r\n")
        else:
            new_text = new_text.replace("\r\n", "\n").replace("\r", "\n")
        path.write_text(new_text, encoding="utf-8")

    # 3. 未决标记与批次黑话检测（仅针对 # 或 // 注释行，杜绝规则定义误报）
    for i, line in enumerate(head_lines):
        stripped = line.strip()
        if not (stripped.startswith("#") or stripped.startswith("//")):
            continue
        if "PENDING_RE" in line or "JARGON_RE" in line or "COMMENT-" in line or "RULE" in line:
            continue
        if PENDING_RE.search(line):
            violations.append({
                "file": str(path),
                "rule": "COMMENT-PENDING-MARKER",
                "detail": f"L{i+1} 注释含未决标记：{line.strip()[:60]}"
            })
        if JARGON_RE.search(line):
            violations.append({
                "file": str(path),
                "rule": "COMMENT-JARGON",
                "detail": f"L{i+1} 注释含批次黑话禁止词：{line.strip()[:60]}"
            })

    # 4. PowerShell 标头三件套硬约束
    if path.suffix == ".ps1":
        violations.extend(_check_ps1_triad(text, path))

    # 5. Bash 安全 Shebang 与安全选项
    if path.suffix == ".sh":
        violations.extend(_check_bash_safety(lines, text, path))

    # 6. Python 模块级 docstring、强类型与注解绑定
    if path.suffix == ".py":
        violations.extend(_check_py_docstring(text, path))
        violations.extend(_check_py_strict_typing(text, path))
        violations.extend(_check_py_annotation_bindings(text, path))

    return violations


def _check_ps1_triad(text: str, path: Path) -> list[dict[str, Any]]:
    """PowerShell 严格工程化标头三件套（Inv-P85-2-2）。"""
    violations = []
    if "[CmdletBinding()]" not in text:
        violations.append({
            "file": str(path),
            "rule": "PS1-CMDLET-BINDING",
            "detail": "缺少 [CmdletBinding()] 严格声明"
        })
    if "Set-StrictMode" not in text:
        violations.append({
            "file": str(path),
            "rule": "PS1-SET-STRICTMODE",
            "detail": "缺少 Set-StrictMode -Version Latest 声明"
        })
    if not PS1_EA_RE.search(text):
        violations.append({
            "file": str(path),
            "rule": "PS1-ERROR-ACTION",
            "detail": "缺少 $ErrorActionPreference = 'Stop' (或 'Continue') 显式声明"
        })
    return violations


def _check_bash_safety(lines: list[str], text: str, path: Path) -> list[dict[str, Any]]:
    """Bash 统一安全标识与 Shebang 契约（Inv-P85-3-3）。"""
    violations = []
    shebang = lines[0] if lines else ""
    if not (shebang.startswith("#!/usr/bin/env bash") or shebang.startswith("#!/bin/bash")):
        violations.append({
            "file": str(path),
            "rule": "BASH-SHEBANG",
            "detail": f"Shebang 非法（须为 #!/usr/bin/env bash）：{shebang[:40]}"
        })
    if "set -uo pipefail" not in text:
        violations.append({
            "file": str(path),
            "rule": "BASH-SAFE-OPTIONS",
            "detail": "缺少 set -uo pipefail 安全选项声明"
        })
    if re.search(r"^\s*set -e\b", text, re.M):
        violations.append({
            "file": str(path),
            "rule": "BASH-BLIND-SET-E",
            "detail": "严禁盲目使用 set -e，须依托显式退出码与状态校验"
        })
    return violations


def _check_py_strict_typing(text: str, path: Path) -> list[dict[str, Any]]:
    """Python 100% 强类型注解与零裸 except 治理（Inv-P85-3-1/2）。"""
    violations = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []  # 语法错误由后续专门规则报告

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            missing_args = [
                a.arg for a in node.args.args
                if a.annotation is None and a.arg not in ("self", "cls")
            ]
            if missing_args:
                violations.append({
                    "file": str(path),
                    "rule": "PY-UNTYPED-ARG",
                    "detail": f"函数「{node.name}」参数缺少类型标注：{', '.join(missing_args)} (L{node.lineno})"
                })
            if node.returns is None:
                violations.append({
                    "file": str(path),
                    "rule": "PY-UNTYPED-RETURN",
                    "detail": f"函数「{node.name}」缺少明确返回值类型注解（如 -> None）(L{node.lineno})"
                })
        elif isinstance(node, ast.ExceptHandler):
            if node.type is None:
                violations.append({
                    "file": str(path),
                    "rule": "PY-BARE-EXCEPT",
                    "detail": f"L{node.lineno} 存在裸 except: 违规，必须显式捕获具体异常元组"
                })
    return violations


def _check_py_docstring(text: str, path: Path) -> list[dict[str, Any]]:
    """py 模块级 docstring：存在且首行为一句话职责说明。"""
    # 允许在 shebang 与头注释后紧随 docstring
    m = re.search(r'"""([\s\S]+?)"""', text)
    if not m or len(m.group(1).strip()) < 8:
        return [{
            "file": str(path),
            "rule": "PY-DOCSTRING",
            "detail": "缺少模块级 docstring 或说明过短"
        }]
    return []


# 定义期即被求值的 typing 名字清单：缺绑定会导致模块导入或函数调用期抛 NameError
ANNOTATION_NAMES = frozenset({
    "Any", "Optional", "Union", "List", "Dict", "Set", "Tuple", "Callable",
    "Iterable", "Iterator", "Sequence", "Mapping", "MutableMapping", "Literal",
    "Generator", "AsyncGenerator", "TypeVar", "Generic", "Protocol", "Final",
    "ClassVar", "Type", "Text", "cast", "overload", "no_type_check", "Never",
})


def _check_py_annotation_bindings(text: str, path: Path) -> list[dict[str, Any]]:
    """Python 注解名字绑定完备性（Inv-P87-3）。"""
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        return [{
            "file": str(path),
            "rule": "PY-ANNOTATION-IMPORT",
            "detail": f"AST 解析失败：{exc}",
        }]

    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            if any(alias.name == "annotations" for alias in node.names):
                return []

    bound: set[str] = set()
    # 导入绑定：全树收集（含函数内局部导入），消除「局部导入 → 误报」噪声
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                bound.add(alias.asname or alias.name.split(".")[0])
    # 模块级定义绑定：函数/类/变量
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    bound.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            bound.add(node.target.id)

    missing: set[str] = set()
    for node in ast.walk(tree):
        annotation: Any = None
        if isinstance(node, ast.arg):
            annotation = node.annotation
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            annotation = node.returns
        elif isinstance(node, ast.AnnAssign):
            annotation = node.annotation
        if annotation is None:
            continue
        for sub in ast.walk(annotation):
            if isinstance(sub, ast.Name) and sub.id in ANNOTATION_NAMES and sub.id not in bound:
                missing.add(sub.id)

    if not missing:
        return []
    return [{
        "file": str(path),
        "rule": "PY-ANNOTATION-IMPORT",
        "detail": "注解引用未绑定的 typing 名字（定义期将 NameError 崩溃）：" + ", ".join(sorted(missing)),
    }]


def main() -> int:
    parser = argparse.ArgumentParser(description="全域脚本库头注释与严格规范化审计")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    parser.add_argument("--fix", action="store_true", help="自动修复等宽线等可安全修复项")
    args = parser.parse_args()

    all_violations: list[dict[str, Any]] = []
    total_files = 0

    for path in iter_targets():
        total_files += 1
        violations = audit_file(path, fix=args.fix)
        all_violations.extend(violations)

    if args.json:
        print(json.dumps({
            "total_files": total_files,
            "violations_count": len(all_violations),
            "violations": all_violations
        }, indent=2, ensure_ascii=False))
        return 1 if all_violations else 0

    print("=" * 78)
    print("📜 全域 74 份活动脚本库全维度严格工程化审查")
    print(f"  • 扫描脚本总数: {total_files} 份")
    print(f"  • 发现违规项: {len(all_violations)} 处")
    print("-" * 78)

    for v in all_violations:
        rel = Path(v["file"]).relative_to(ROOT.parent if (ROOT.parent / "scripts").exists() else ROOT)
        print(f"  ✗ [{v['rule']}] {rel}: {v['detail']}")

    print("=" * 78)
    if all_violations:
        print(f"【审查结论】未通过（发现 {len(all_violations)} 项工程化规范违规）")
        return 1

    print("【审查结论】通过（全域脚本 100% 对齐六字段、路径真实性、78 等宽线、零黑话、PS1/Bash/Python 严格约束）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
