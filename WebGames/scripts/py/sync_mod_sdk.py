#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 同步引擎)
# 文件路径: WebGames/scripts/py/sync_mod_sdk.py
# 架构定位: MOD SDK 权威真源静态萃取与契约同步引擎 CLI 门面 (MOD SDK Sync CLI Facade)
# 依赖与触发: 触发方: CI / 预提交钩子 / audit_sdk_sync.py | 上游: config/** | 下游: mod_sdk/** | 运行时: Python 3.10+
# 职责说明: 调度静态提取引擎权威真源、生成/更新 capabilities.json 与 MOD_SPEC.md、提供 --check-only 契约漂移判定
# 退出语义与设计依据: 退出码: 0=同步成功/无漂移, 1=契约漂移/校验失败, 2=配置缺失/运行异常 | 设计依据: AGENTS.md 契约防漂移与单源规则契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python WebGames/scripts/py/sync_mod_sdk.py
#   python WebGames/scripts/py/sync_mod_sdk.py --check-only
#   python WebGames/scripts/py/sync_mod_sdk.py --json
# ==============================================================================
"""MOD SDK 权威真源静态萃取与契约同步引擎 CLI 入口门面。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

# 兼容性导入与共享底盘 re-export
from lib.mod_sdk_shared import (
    STANDARD_PLACEHOLDER_DOCS,
    SUPPORTED_ERROR_CODES,
    check_contract_drift,
    collect_placeholders_from_obj,
    ensure_utf8_stdout,
    extract_agent_hud_telemetry_capabilities,
    extract_builtin_dag_ids,
    extract_capabilities,
    extract_destiny_capabilities,
    extract_unified_protocol_capabilities,
    format_capabilities_json,
    generate_autogen_spec_section,
    load_json_file,
    render_full_mod_spec,
    resolve_webgames_root,
)

__all__ = [
    "STANDARD_PLACEHOLDER_DOCS",
    "SUPPORTED_ERROR_CODES",
    "check_contract_drift",
    "collect_placeholders_from_obj",
    "ensure_utf8_stdout",
    "extract_agent_hud_telemetry_capabilities",
    "extract_builtin_dag_ids",
    "extract_capabilities",
    "extract_destiny_capabilities",
    "extract_unified_protocol_capabilities",
    "format_capabilities_json",
    "generate_autogen_spec_section",
    "load_json_file",
    "main",
    "render_full_mod_spec",
    "resolve_webgames_root",
    "sync_to_disk",
]


def sync_to_disk(webgames_root: Path, capabilities: dict[str, Any]) -> None:
    """将萃取的能力清单与文档原子写入磁盘。"""
    mod_sdk_dir = webgames_root / "mod_sdk"
    mod_sdk_dir.mkdir(parents=True, exist_ok=True)

    cap_path = mod_sdk_dir / "capabilities.json"
    spec_path = mod_sdk_dir / "MOD_SPEC.md"

    # 1. 写入 capabilities.json
    cap_content = format_capabilities_json(capabilities)
    cap_path.write_text(cap_content, encoding="utf-8", newline="\n")
    print(f"✔ 已同步能力清单: {cap_path}")

    # 2. 写入或注入 MOD_SPEC.md
    existing_spec = (
        spec_path.read_text(encoding="utf-8") if spec_path.is_file() else None
    )
    spec_content = render_full_mod_spec(capabilities, existing_spec)
    spec_path.write_text(spec_content, encoding="utf-8", newline="\n")
    print(f"✔ 已同步开发契约规范: {spec_path}")


def main() -> int:
    """CLI 入口主函数。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔引擎 MOD 开发者 SDK 权威真源静态萃取与防漂移同步引擎"
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="比对磁盘既有文件与内存萃取结果，检测到差异返回非 0 退出码（CI 门禁阻断）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="输出萃取的 capabilities 结构化 JSON 到标准输出",
    )
    args = parser.parse_args()

    root = resolve_webgames_root()
    capabilities = extract_capabilities(root)

    if args.json:
        print(format_capabilities_json(capabilities))
        return 0

    if args.check_only:
        is_clean, diffs = check_contract_drift(root, capabilities)
        if is_clean:
            print("✔ MOD SDK 契约与引擎真源保持 100% 绝对一致，未检测到任何漂移。")
            return 0
        print("✖ BLOCK 检测到 MOD SDK 契约发生漂移！", file=sys.stderr)
        for diff in diffs:
            print(diff, file=sys.stderr)
        print(
            "\n请运行 python WebGames/scripts/py/sync_mod_sdk.py 重新同步最新权威契约。",
            file=sys.stderr,
        )
        return 1

    sync_to_disk(root, capabilities)
    return 0


if __name__ == "__main__":
    sys.exit(main())
