#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/py/audit_arch.py
# 架构定位: 静态分析引擎 (Static Audit Engine)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend 源码 | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 审计领域架构合规性，断言无后端跨层直连、单例幂等重置与清单条目自洽
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规 | 设计依据: GD老练风格硬性规范标准 架构解耦契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_arch.py
#   python scripts/py/audit_arch.py --json
# ==============================================================================
"""架构护栏审查 Python 桥接器：在 headless Godot 中执行 tests/arch_runner.gd 并回传结果。"""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()
ROOT = resolve_repo_root()


def main() -> int:
    godot_bin = os.environ.get("GODOT_BIN") or os.environ.get("GODOT") or "godot"
    godot_path = shutil.which(godot_bin)
    if not godot_path:
        print(f"【audit-arch】未找到 Godot 可执行文件: {godot_bin}，跳过架构护栏（提示级）")
        return 0

    print("【audit-arch】启动无头 Godot 执行架构护栏...")
    cmd = [godot_path, "--headless", "--path", str(ROOT), "-s", "res://tests/arch_runner.gd"]
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")

    if proc.stdout:
        print(proc.stdout.strip())
    if proc.stderr:
        print(proc.stderr.strip(), file=sys.stderr)

    if proc.returncode == 0:
        print("【审查结论】通过（架构护栏无违规）")
        return 0
    else:
        print(f"【审查结论】未通过（架构护栏退出码 {proc.returncode}）")
        return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
