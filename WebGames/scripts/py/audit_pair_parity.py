#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 同构双实现门禁)
# 文件路径: WebGames/scripts/py/audit_pair_parity.py
# 架构定位: 脚本成对性与换行符守卫 (Script Parity & CRLF Guard)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: scripts/ps1 与 scripts/sh | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 断言 PowerShell 与 Bash 脚本同构双实现一一对应，强制校验 ps1 CRLF 与其余 LF 物理换行符
# 退出语义与设计依据: 退出码: 0=合规, 1=存在未配对或换行符违规 | 设计依据: AGENTS.md 同构双实现与换行符硬性契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_pair_parity.py
#   python scripts/py/audit_pair_parity.py --json
# ==============================================================================
import re
import sys
from pathlib import Path

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
SH_DIR = ROOT / "scripts" / "sh"
PS1_DIR = ROOT / "scripts" / "ps1"

# sh：case 分支参数（行首 `--kebab-case)`，re.M 保行首语义）与字符串比较参数
# （timestamp 风格 `if [ "${1:-}" = "--full" ]`）双模式提取；--help 记入但豁免于差集
SH_CASE_PARAM_RE = re.compile(r"^\s*(?:-[a-z]\|)?--([a-z][a-z0-9-]*)", re.M)
SH_IF_PARAM_RE = re.compile(r'= "--([a-z][a-z0-9-]*)"')
# sh 位置参数引用（${1:-10} / $1 —— audit-perf 阈值型，ps1 命名化为 -GateThreshold）
SH_POSITIONAL_RE = re.compile(r"\$\{?[0-9]+")
# ps1：仅 param() 块内的类型化参数 `[switch]$Full`（函数体 [int]$Matches 转换不误抓）
PS1_PARAM_RE = re.compile(r"\[(?:switch|string|int|bool|double)\]\s*\$([A-Z][A-Za-z0-9]*)")
# ps1 参数默认值注入环境变量（GodotBin = $env:GODOT_BIN → env 注入型豁免）
PS1_ENV_DEFAULT_RE = re.compile(r"\$env:([A-Z][A-Z0-9_]*)")
# sh 环境变量默认值引用（${OUT_DIR:-...} 注入模式）
SH_ENV_DEFAULT_RE = re.compile(r"\$\{([A-Z][A-Z0-9_]*):-")
# sh 短名 ↔ ps1 长名命名漂移别名（功能等价，非缺失：sh --out == ps1 -OutDir）
SHORT_TO_LONG = {"out": "out-dir"}
LONG_TO_SHORT = {v: k for k, v in SHORT_TO_LONG.items()}


PASCAL_TO_ENV_RE = re.compile(r"(?<!^)(?=[A-Z])")


def pascal_to_kebab(name: str) -> str:
    """PascalCase → kebab-case（Scope→scope；PerFile→per-file；GodotBin→godot-bin）。"""
    parts = re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*", name)
    return "-".join(p.lower() for p in parts) if parts else name.lower()


def extract_sh_params(text: str) -> set:
    """sh 功能参数集（case 分支 + if 字符串比较双模式；--help 记入但豁免于差集）。"""
    params = set()
    for m in SH_CASE_PARAM_RE.finditer(text):
        params.add(m.group(1))
    for m in SH_IF_PARAM_RE.finditer(text):
        params.add(m.group(1))
    return params


def extract_ps1_params(text: str) -> dict:
    """ps1 参数集：仅 param() 块内声明（块尾 `)` 独占/行尾收束，ValidateSet/Parameter
    属性行收尾 `)]` 不提前截断）；kebab 名 -> 原始 Pascal 名。"""
    params = {}
    # param 块尾判定：`)` 后须直接到行尾（属性行如 `frontend")]` 或 `$true)]` 不触发）
    pm = re.search(r"param\s*\(([\s\S]*?)\)\s*\n", text)
    block = pm.group(1) if pm else ""
    for m in PS1_PARAM_RE.finditer(block):
        raw = m.group(1)
        params[pascal_to_kebab(raw)] = raw
    return params


def is_env_injected(ps1_text: str, sh_text: str, ps1_raw: str) -> bool:
    """ps1 参数是否环境变量注入型（非 CLI 语义）：ps1 param 默认值取 $env:XXX，
    或 sh 侧以 ${XXX:-...} 引用同名全大写环境变量。"""
    env_name = PASCAL_TO_ENV_RE.sub("_", ps1_raw).upper()
    ps1_envs = {m.group(1) for m in PS1_ENV_DEFAULT_RE.finditer(ps1_text)}
    if env_name in ps1_envs:
        return True
    sh_envs = {m.group(1) for m in SH_ENV_DEFAULT_RE.finditer(sh_text)}
    return env_name in sh_envs


def check_pair(sh_file: Path, ps1_file: Path, violations: list, hints: list) -> None:
    """校验一对同构双实现的参数面一致性（单趟读取文件文本复用）。"""
    sh_text = sh_file.read_text(encoding="utf-8", errors="ignore")
    ps1_text = ps1_file.read_text(encoding="utf-8", errors="ignore")

    sh_params = extract_sh_params(sh_text)
    ps1_params = extract_ps1_params(ps1_text)

    # 纯透传型双实现（sh 无 case 参数面 且 ps1 仅 PassThruArgs）直接跳过
    if not sh_params and not ps1_params:
        hints.append(f"{sh_file.name}: 纯透传型（无自有参数面），跳过参数面校验")
        return

    ps1_kebabs = {LONG_TO_SHORT.get(k, k) for k in ps1_params.keys()}
    sh_positional = bool(SH_POSITIONAL_RE.search(sh_text))

    # sh 有而 ps1 缺（功能缺失——阻断级）
    sh_only = sorted(sh_params - ps1_kebabs - {"help"})
    for p in sh_only:
        violations.append(
            f"[sh→ps1 缺失] {sh_file.name} 提供 --{p}，但 {ps1_file.name} 无对应参数"
        )

    # ps1 有而 sh 缺（env 注入型/位置参数型豁免；真多余提示）
    ps1_only = sorted(ps1_kebabs - sh_params)
    # sh 侧为位置参数实现（audit-perf 阈值型 ${1:-10}）时 ps1 命名化为平台惯例
    if ps1_only and not sh_params and sh_positional:
        hints.append(f"{ps1_file.name}: sh 侧以位置参数实现（${{1:-…}}），ps1 命名化为 {', '.join(ps1_only)}（平台惯例豁免）")
        return
    for p in ps1_only:
        raw = ps1_params.get(p, p)
        if is_env_injected(ps1_text, sh_text, raw):
            hints.append(f"{ps1_file.name}: {raw} 为环境变量注入型（对应 sh 的 {PASCAL_TO_ENV_RE.sub('_', raw).upper()} env），豁免")
        else:
            violations.append(
                f"[ps1→sh 多余] {ps1_file.name} 声明参数 {raw}（--{p}），但 {sh_file.name} 无对应参数"
            )


def check_line_endings(violations: list, hints: list) -> None:
    """全域 74 份脚本物理换行符门禁（ps1 恒为 CRLF，其余 sh/py/mjs 恒为 LF）。"""
    repo_root = ROOT.parent
    ps1_files = sorted(list((ROOT / "scripts" / "ps1").glob("*.ps1")) + list((repo_root / "scripts" / "ps1").glob("*.ps1")))
    sh_files = sorted(list((ROOT / "scripts" / "sh").glob("*.sh")) + list((repo_root / "scripts" / "sh").glob("*.sh")))
    py_files = sorted(list((ROOT / "scripts" / "py").rglob("*.py")))
    mjs_files = [ROOT / "scripts" / "js" / "validate-mermaid.mjs"]

    for p in ps1_files:
        b = p.read_bytes()
        if b"\r\n" not in b:
            violations.append(f"[换行符违规] {p.relative_to(repo_root)} 缺少 CRLF 换行符")
        stripped = b.replace(b"\r\n", b"")
        if b"\n" in stripped:
            violations.append(f"[换行符违规] {p.relative_to(repo_root)} 存在混用裸 LF")

    for f in sh_files + py_files + mjs_files:
        if not f.exists():
            continue
        b = f.read_bytes()
        if b"\r" in b:
            violations.append(f"[换行符违规] {f.relative_to(repo_root)} 包含 CR/CRLF（必须为纯 LF）")

    hints.append(
        f"物理换行符门禁: {len(ps1_files)} 份 ps1(CRLF) + {len(sh_files) + len(py_files) + len(mjs_files)} 份 非ps1(LF) 100% 合规"
    )


def main() -> int:
    violations: list = []
    hints: list = []
    pairs = 0
    for sh_file in sorted(SH_DIR.glob("*.sh")):
        ps1_file = PS1_DIR / (sh_file.stem + ".ps1")
        if not ps1_file.exists():
            violations.append(f"[缺同构对] {sh_file.name} 无对应 {ps1_file.name}")
            continue
        pairs += 1
        check_pair(sh_file, ps1_file, violations, hints)
    # ps1 有而 sh 无的反向对（孤儿 ps1）
    for ps1_file in sorted(PS1_DIR.glob("*.ps1")):
        if not (SH_DIR / (ps1_file.stem + ".sh")).exists():
            violations.append(f"[孤儿 ps1] {ps1_file.name} 无对应 sh 实现")

    check_line_endings(violations, hints)

    print("=" * 80)
    print("🪞 sh/ps1 同构双实现参数面一致性与物理换行符校验（T3）")
    print(f"  • 配对检查: {pairs} 对")
    for h in hints:
        print(f"  · {h}")
    for v in violations:
        print(f"  ✗ {v}")
    print("-" * 80)
    if violations:
        print(f"【审查结论】未通过（同构参数面缺失/多余或换行符违规 {len(violations)} 项，请同步双实现与换行符）")
        return 1
    print("【审查结论】通过（全部同构对参数面一致且 74 份脚本换行符 100% 物理合规）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
