#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态架构规则扩展)
# 文件路径: WebGames/scripts/py/lib/arch_guard_security_rules.py
# 架构定位: 密码学域边界隔离与静态资源路径精确存在性断言子模块
# 依赖与触发: 触发方: arch_guard_rules / audit_arch_static | 上游: backend/ 与 frontend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 执行 TC-ARCH-13 密码学隔离与零静态密钥断言及 TC-ARCH-14 res:// 大小写精确存在性检查
# 退出语义与设计依据: 规则库模块，无进程退出码 | 设计依据: CRYPTO-ISOLATION-001 与 Linux CI 大小写精确防断链原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.arch_guard_security_rules import check_tc_arch_13, check_tc_arch_14
# ==============================================================================
"""架构护栏安全与资源路径静态规则子模块 (TC-ARCH-13 / TC-ARCH-14)。"""

from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
import re

from lib.arch_guard_common import RES_PREFIX, iter_gd_sources, strip_string_contents

ALLOWED_CRYPTO_FILES: frozenset[str] = frozenset(
    {
        "backend/infrastructure/pure/crypto_integrity_lib.gd",
    }
)
_UNSAFE_MAC_EQ_RE = re.compile(
    r"\b(?:expected_mac|mac_hex|recorded_seal|expected_hmac|recorded_hash)\b\s*[!=]=\s*"
)
_HARDCODED_KEY_LITERAL_RE = re.compile(
    r'(?:const|var)\s+[a-z0-9_]*(?:seal_key|hmac_key|aes_key|private_key|master_secret|signing_key)\b[^=\n]*=\s*"([^"\n]{8,})"',
    re.IGNORECASE,
)
_PRELOAD_RES_RE = re.compile(
    r'\b(?:preload|ResourceLoader\.load)\s*\(\s*"(res://[^"\n]+)"'
)


def check_tc_arch_13(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
    """TC-ARCH-13: 密码学纯计算库边界隔离、常量时间比对与零静态密钥字面量断言。"""
    violations: list[str] = []
    crypto_raw_re = re.compile(r"\b(?:AESContext|Crypto)\.new\s*\(|\.hmac_digest\s*\(")

    for rel_posix, code in iter_gd_sources(ctx, strip_comments):
        rel_res = RES_PREFIX + rel_posix
        is_crypto_lib = rel_posix in ALLOWED_CRYPTO_FILES
        masked = strip_string_contents(code)

        for idx, (raw_ln, m_ln) in enumerate(
            zip(code.splitlines(), masked.splitlines()), 1
        ):
            if not is_crypto_lib and crypto_raw_re.search(m_ln):
                violations.append(
                    f"{rel_res}:{idx}: 禁止在 CryptoIntegrityLib 之外直接调用 AESContext/Crypto/hmac_digest（CRYPTO-ISOLATION-001）"
                )
            if not is_crypto_lib and _UNSAFE_MAC_EQ_RE.search(m_ln):
                violations.append(
                    f"{rel_res}:{idx}: 敏感 MAC/Seal/Hash 校验禁止直接 ==/!= 比对，必须调用 CryptoIntegrityLib.constant_time_equals（CRYPTO-TIMING-001）"
                )
            km = _HARDCODED_KEY_LITERAL_RE.search(raw_ln)
            if km and not re.match(r"^[A-Z0-9_]+$", km.group(1)):
                violations.append(
                    f"{rel_res}:{idx}: 疑似硬编码静态密钥字面量，必须由环境变量或安全 Vault 动态注入（CRYPTO-SECRET-001）"
                )

    return make_result(
        "TC-ARCH-13: 密码学域库边界隔离与防时序侧信道合规断言", violations
    )


def check_tc_arch_14(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
    """TC-ARCH-14: 全库静态 preload/ResourceLoader.load 资源路径严格区分大小写存在性断言。"""
    violations: list[str] = []
    dir_entries_cache: dict[Path, set[str]] = {}

    def _cached_exact_exists(rel_posix: str) -> bool:
        cur = ctx.root
        parts = [p for p in rel_posix.split("/") if p]
        if not parts:
            return False
        for part in parts:
            names = dir_entries_cache.get(cur)
            if names is None:
                if not cur.is_dir():
                    return False
                try:
                    names = {child.name for child in cur.iterdir()}
                except OSError:
                    return False
                dir_entries_cache[cur] = names
            if part not in names:
                return False
            cur = cur / part
        return cur.exists()

    for sub in ("backend", "frontend", "dev_harness"):
        sub_dir: Path = ctx.root / sub
        if not sub_dir.exists():
            continue
        for gd_file in sorted(sub_dir.rglob("*.gd")):
            rel_src = gd_file.relative_to(ctx.root).as_posix()
            code = strip_comments(gd_file.read_text(encoding="utf-8", errors="ignore"))
            for idx, ln in enumerate(code.splitlines(), 1):
                for m in _PRELOAD_RES_RE.finditer(ln):
                    res_path = m.group(1)
                    if not _cached_exact_exists(res_path[len(RES_PREFIX) :]):
                        violations.append(
                            f"{RES_PREFIX}{rel_src}:{idx}: 静态加载路径不存在或大小写不匹配 -> {res_path}"
                        )

    return make_result(
        "TC-ARCH-14: 全库静态 res:// 路径精确大小写存在性断言", violations
    )
