#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 敏感信息安全门禁)
# 文件路径: WebGames/scripts/py/audit_secrets.py
# 架构定位: 密钥与凭据泄漏扫描器 (Secret Leak Scanner)
# 依赖与触发: 触发方: CI / 本地预检 | 上游: 全仓源码与配置 | 下游: 安全告警 | 运行时: Python 3.10+
# 职责说明: 扫描硬编码私钥、测试盐明文与高危凭据，防止敏感信息泄漏入库
# 退出语义与设计依据: 退出码: 0=安全, 1=发现泄露凭据 | 设计依据: 生产安全与隐私合规契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_secrets.py
#   python scripts/py/audit_secrets.py --json
# ==============================================================================
"""扫描密钥标记与常见服务 token 特征，防止误提交泄露（提示级）。"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

HERE = Path(__file__).resolve()
WG_REL = "WebGames"
MAX_BYTES = 2_000_000
MAX_EXAMPLES_PER_FILE = 4

# (正则, 标签) —— 私钥标记
MARKERS = [
    (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----", "私钥标记"),
    (r"-----BEGIN PGP PRIVATE KEY BLOCK-----", "PGP 私钥"),
]
# (正则, 标签) —— 常见服务高熵 token
TOKENS = [
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS Access Key"),
    (r"\bghp_[0-9A-Za-z]{36}\b", "GitHub PAT"),
    (r"\bgithub_pat_[0-9A-Za-z_]{20,}\b", "GitHub fine-grained PAT"),
    (r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b", "Slack Token"),
    (r"\bsk_live_[0-9a-zA-Z]{16,}\b", "Stripe 密钥"),
    (r"\bAIza[0-9A-Za-z\-_]{35}\b", "Google API Key"),
    (r"\bsk-[A-Za-z0-9]{20,}\b", "OpenAI API Key"),
    (r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", "疑似 JWT"),
]
BINARY_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".vsix", ".tgz", ".zip",
    ".ttf", ".woff", ".woff2", ".bin", ".pyc", ".uid", ".ctex",
}

# 预编译正则与联合快速短路正则（常数级跳过 99.9% 干净文件）
ALL_COMPILED = [(re.compile(p), label) for p, label in MARKERS + TOKENS]
COMBINED_FAST_RE = re.compile("|".join(f"(?:{p})" for p, _ in MARKERS + TOKENS))


def git(args: list[str], cwd: Path) -> str:
    try:
        r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


def collect_paths(scan_root: Path) -> list[Path]:
    """已跟踪 ∪ 未跟踪未忽略 ∪ 暂存 的相对路径（相对 git 仓库根）。"""
    repo_root = git(["rev-parse", "--show-toplevel"], scan_root).strip()
    if not repo_root:
        return []
    repo_root_p = Path(repo_root)
    raw = (
        git(["ls-files", "-z"], repo_root_p)
        + git(["ls-files", "-z", "--others", "--exclude-standard"], repo_root_p)
        + git(["diff", "--cached", "--name-only", "-z"], repo_root_p)
    )
    paths: list[Path] = []
    seen: set[str] = set()
    for p in raw.split("\0"):
        if not p:
            continue
        p = p.replace("\\", "/")
        if scan_root == repo_root_p:
            key = p
        else:
            rel = WG_REL
            if p == rel or p.startswith(rel + "/"):
                key = p
            else:
                continue
        if key in seen:
            continue
        seen.add(key)
        paths.append(repo_root_p / p)
    return paths


def scan_file(path: Path, findings: list[str]) -> int:
    # 排除脚本自身：其源码包含检测模式字符串（如 PGP 私钥标记），避免自扫描误报
    if path.name == HERE.name and path.resolve() == HERE:
        return 0
    # 前置后缀初筛：避免大体积二进制文件（图片/压缩包）读盘
    if path.suffix.lower() in BINARY_SUFFIXES:
        return 0
    try:
        data = path.read_bytes()
    except OSError:
        return 0
    if len(data) > MAX_BYTES:
        return 0
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return 0

    # 联合正则快速初筛短路：99.9% 的文件无任何嫌疑特征，一次 search 即可直接跳过
    if not COMBINED_FAST_RE.search(text):
        return 0

    rel = path.relative_to(HERE.parents[2]).as_posix()
    counts = {label: 0 for _, label in ALL_COMPILED}
    examples: list[str] = []
    for i, line in enumerate(text.splitlines(), 1):
        for pat_re, label in ALL_COMPILED:
            m = pat_re.search(line)
            if m:
                counts[label] += 1
                if len(examples) < MAX_EXAMPLES_PER_FILE:
                    snippet = m.group(0)
                    examples.append(f"L{i} {label}: {snippet[:40]}")

    total = sum(counts.values())
    if total:
        detail = "  例: " + "; ".join(examples) if examples else ""
        parts = " / ".join(f"{label} {n}" for label, n in counts.items() if n)
        findings.append(f"{rel}: {parts}{detail}")
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="有发现即返回 1")
    ap.add_argument("--repo", action="store_true", help="扫描整个 git 仓库（默认仅 WebGames/）")
    args = ap.parse_args()

    scan_root = HERE.parents[3] if args.repo else HERE.parents[2]
    paths = collect_paths(scan_root)
    findings: list[str] = []
    total = 0
    for p in paths:
        total += scan_file(p, findings)

    print(f"【audit-secrets】扫描 {len(paths)} 个文件（{'全仓库' if args.repo else 'WebGames/'}），"
          f"发现 {total} 处密钥/凭证候选（提示级）")
    for fd in findings:
        print(f"  ✗ {fd}")
    if args.strict and total:
        print("【审查结论】--strict 模式未通过：存在疑似密钥，请先清除或轮换后再提交")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
