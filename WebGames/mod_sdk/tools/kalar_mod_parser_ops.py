#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · CLI 工程与打包参数注册器)
# 文件路径: WebGames/mod_sdk/tools/kalar_mod_parser_ops.py
# 架构定位: `kalar_mod` 打包/协议/工作台/部署子命令参数构建子模块
# 依赖与触发: 触发方: kalar_mod.py | 上游: argparse SubParsersAction | 下游: CLI 参数解析 | 运行时: Python 3.10+
# 职责说明: 注册 pack、dispatch、workbench、bake、install、dev、inspect 子命令的参数定义
# 退出语义与设计依据: 参数构造辅助模块，无进程退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》与门面解耦原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from kalar_mod_parser_ops import register_ops_subparsers
# ==============================================================================
"""`kalar_mod` CLI 打包、协议派发与部署运维子命令参数注册子模块。"""

from __future__ import annotations
from typing import Any


def _register_pack_and_dispatch(subparsers: Any) -> None:
    p_pack = subparsers.add_parser(
        "pack", help="验证并打包 MOD 为 .kmod 二进制分发包"
    )
    p_pack.add_argument("mod_dir", help="待打包的 MOD 根目录路径")
    p_pack.add_argument(
        "-o", "--output", default=None, dest="output", help="目标分发包路径 (.kmod)"
    )
    p_pack.add_argument(
        "--no-check", action="store_true", dest="no_check",
        help="跳过打包前的静态诊断与资产审计门禁",
    )
    p_pack.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化 JSON 打包结果"
    )

    p_disp = subparsers.add_parser(
        "dispatch", help="离线派发全域统一协议请求并执行请求信封校验"
    )
    p_disp.add_argument(
        "--actor", choices=["HUMAN_UI", "AGENT"], default="HUMAN_UI",
        help="操作发起方主体类型 (默认 HUMAN_UI)",
    )
    p_disp.add_argument(
        "--domain", default="ESC_MENU", help="目标业务领域名称 (默认 ESC_MENU)"
    )
    p_disp.add_argument(
        "--action", default="ESC_QUERY_READINESS", help="具体指令动作类型"
    )
    p_disp.add_argument(
        "--payload", default="{}", help="业务载荷 JSON 字符串 (默认 {})"
    )
    p_disp.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化响应信封 JSON"
    )


def _register_workbench_and_bake(subparsers: Any) -> None:
    p_wb = subparsers.add_parser(
        "workbench", help="纯净世界引擎 MOD 开发者集成工作台统一命令台"
    )
    p_wb.add_argument(
        "workbench_args", nargs="*", help="传递给工作台的子命令或参数"
    )
    p_wb.add_argument(
        "--self-test", action="store_true", dest="self_test",
        help="执行工作台内部集成自测试",
    )
    p_wb.add_argument(
        "--verify", dest="verify_target", default=None,
        help="校验指定 .kmod 归档包完整性与指纹",
    )
    p_wb.add_argument(
        "--inspect", dest="inspect_target", default=None,
        help="检查指定 .kmod 二进制归档包头与段摘要",
    )
    p_wb.add_argument(
        "--export-json", dest="export_json", default=None,
        help="将 .kmod 反编译还原为 JSON 调试目录",
    )
    p_wb.add_argument(
        "-p", "--pack", dest="pack_target", default=None,
        help="打包指定 MOD 物理目录为 .kmod",
    )
    p_wb.add_argument(
        "-o", "--output", dest="output", default=None, help="输出目标路径"
    )

    p_bake = subparsers.add_parser(
        "bake", help="将 JSON 配置表或目录编译为紧凑二进制流 (.kdat)"
    )
    p_bake.add_argument("input_path", help="输入源 JSON 文件或配置目录")
    p_bake.add_argument(
        "-o", "--output", dest="output", default=None, help="输出 .kdat 路径"
    )
    p_bake.add_argument(
        "--monolithic", action="store_true", help="编译为单一融合包 config.kdat"
    )
    p_bake.add_argument(
        "--no-compress", action="store_true", help="禁用数据压缩"
    )


def register_ops_subparsers(subparsers: Any) -> None:
    """向 argparse subparsers 注册 pack/dispatch/workbench/bake/install/dev/inspect 子命令。"""
    _register_pack_and_dispatch(subparsers)
    _register_workbench_and_bake(subparsers)

    p_install = subparsers.add_parser(
        "install", help="验证并安装 .kmod 归档包或 MOD 源目录到引擎 mods/ 目录"
    )
    p_install.add_argument("source", help=".kmod 归档文件或 MOD 源目录路径")
    p_install.add_argument(
        "--mods-dir", dest="mods_dir", default=None, help="目标 mods/ 安装根目录"
    )
    p_install.add_argument(
        "--force", action="store_true", help="若目标已存在则强制覆盖安装"
    )
    p_install.add_argument(
        "--json", action="store_true", dest="as_json", help="输出 JSON 结果"
    )

    p_dev = subparsers.add_parser(
        "dev", help="调试(JSON)与正式封装(.kmod/.kdat)一体化开发流水线"
    )
    p_dev.add_argument(
        "mod_dir", nargs="?", default=".", help="待调试/封装的 MOD 根目录"
    )
    p_dev.add_argument(
        "--simulate", action="store_true", help="附加运行无头 DAG 剧情仿真推演"
    )
    p_dev.add_argument(
        "--pack", action="store_true", help="校验通过后封装为正式 .kmod"
    )
    p_dev.add_argument(
        "-o", "--output", default=None, dest="output",
        help="指定 .kmod 输出路径 (自动启用 --pack)",
    )
    p_dev.add_argument(
        "--install", action="store_true",
        help="打包后直接安装到 mods/ (自动启用 --pack)",
    )
    p_dev.add_argument(
        "--mods-dir", dest="mods_dir", default=None, help="目标 mods/ 安装根目录"
    )
    p_dev.add_argument(
        "--force", action="store_true", help="覆盖安装已存在的目标 .kmod"
    )
    p_dev.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化 JSON 报告"
    )

    p_inspect = subparsers.add_parser(
        "inspect", help="检查 .kmod 二进制段信息或反向还原 JSON 调试工作区"
    )
    p_inspect.add_argument("kmod_file", help="待检查的 .kmod 二进制归档包路径")
    p_inspect.add_argument(
        "--export-json", dest="export_json", default=None,
        help="反向导出为可编辑 JSON 调试目录",
    )
    p_inspect.add_argument(
        "--json", action="store_true", dest="as_json", help="输出结构化 JSON 结果"
    )
