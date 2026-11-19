#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · CLI 核心参数注册器)
# 文件路径: WebGames/mod_sdk/tools/kalar_mod_parser_core.py
# 架构定位: `kalar_mod` 核心研发流子命令 (init/check/cook/preview) 参数构建子模块
# 依赖与触发: 触发方: kalar_mod.py | 上游: argparse SubParsersAction | 下游: CLI 参数解析 | 运行时: Python 3.10+
# 职责说明: 注册 init、check、cook、preview 四项基础校验与演习子命令的 argparse 定义
# 退出语义与设计依据: 参数构造辅助模块，无进程退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》与门面解耦原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from kalar_mod_parser_core import register_core_subparsers
# ==============================================================================
"""`kalar_mod` CLI 核心校验与预览子命令参数注册子模块。"""

from __future__ import annotations
from typing import Any


def register_core_subparsers(subparsers: Any) -> None:
    """向 argparse subparsers 注册 init、check、cook、preview 子命令参数。"""
    p_init = subparsers.add_parser(
        "init", help="初始化生成新的纯净世界引擎 MOD 项目骨架"
    )
    p_init.add_argument(
        "--id", required=True, dest="pack_id", help="MOD 包唯一标识符 (如 mod_elf_story)"
    )
    p_init.add_argument(
        "--name", required=True, dest="pack_name", help="MOD 人类可读名称"
    )
    p_init.add_argument(
        "--race", default="HUMAN", dest="race_id", help="默认绑定角色种族 (默认 HUMAN)"
    )
    p_init.add_argument(
        "--output-dir", default=None, dest="output_dir", help="生成目标目录路径"
    )
    p_init.add_argument(
        "--tier", type=int, choices=[1, 2, 3], default=2, dest="tier",
        help="模组复杂度层级 (1=纯剧情, 2=命途扩展, 3=富媒体与大魔改)",
    )
    p_init.add_argument(
        "--with-destiny", action="store_true", dest="with_destiny", default=True,
        help="生成命途扩展配置文件 destinies.json",
    )
    p_init.add_argument(
        "--no-destiny", action="store_false", dest="with_destiny",
        help="跳过生成 destinies.json",
    )
    p_init.add_argument(
        "--inline-text", action="store_true", dest="inline_text", default=False,
        help="在因果图元中直接内联文本，免除外部多语言字典强依赖",
    )

    p_check = subparsers.add_parser(
        "check", help="纯静态轻量自愈诊断 MOD 清单、DAG 因果图元与资产引用"
    )
    p_check.add_argument(
        "mod_dir", nargs="?", default=".", help="待诊断 MOD 根目录 (默认当前目录)"
    )
    p_check.add_argument(
        "--check-multi", nargs="+", dest="multi_dirs", default=None,
        help="多包联合冲突预检的 MOD 目录列表",
    )
    p_check.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化 JSON 诊断信息"
    )

    p_cook = subparsers.add_parser(
        "cook", help="扫描、审计与预编译 assets/ 资源清单 (manifest.json)"
    )
    p_cook.add_argument(
        "mod_dir", nargs="?", default=".", help="待审计/预编译的 MOD 根目录"
    )
    p_cook.add_argument(
        "--check", action="store_true", dest="check_only",
        help="只读门禁模式：校验格式白名单、体积预算与清单同步状态",
    )
    p_cook.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化 JSON 报告"
    )

    p_prev = subparsers.add_parser(
        "preview", help="无头演习推演 MOD 剧情流转与四级路由分支"
    )
    p_prev.add_argument(
        "mod_dir", nargs="?", default=".", help="待演习 MOD 根目录 (默认当前目录)"
    )
    p_prev.add_argument(
        "--simulate", action="store_true", dest="simulate",
        help="启动全分支剧情推演与文本字段填充",
    )
    p_prev.add_argument(
        "--race", default="HUMAN", dest="race_id", help="模拟角色种族 (默认 HUMAN)"
    )
    p_prev.add_argument(
        "--name", default="阿尔温", dest="player_name", help="模拟角色名称"
    )
    p_prev.add_argument(
        "--origin", default=None, dest="origin_id", help="指定演习创角身世 ID"
    )
    p_prev.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化 JSON 演习报告"
    )
