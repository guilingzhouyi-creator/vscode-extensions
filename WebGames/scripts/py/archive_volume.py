#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 周期归档内核)
# 文件路径: WebGames/scripts/py/archive_volume.py
# 架构定位: 归档调度引擎 (Core Archive Engine)
# 依赖与触发: 触发方: 本地 CLI / archive-volume.sh/ps1 | 上游: docs/路线图 | 下游: docs/归档库 | 运行时: Python 3.10+
# 职责说明: 自动化完成短期施工区阶段性案卷封存、元数据同步、导航条注入与全宗目录重建
# 退出语义与设计依据: 退出码: 0=归档成功, 1=阻断错误, 2=用法错误 | 设计依据: AGENTS.md 周期封存契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/archive_volume.py --detect
#   python scripts/py/archive_volume.py --cycle --apply
#   python scripts/py/archive_volume.py --all --apply
# ==============================================================================
"""archive_volume.py — 路线图工程化四大阶段自动检测、周期归档、打标与总索引精准清理系统。

作为命令行 CLI 入口门面与自测夹具，负责参数解析分发与标准化退出码映射，
业务逻辑全面收敛至 scripts/py/archive 包中。"""
import argparse
import sys
import tempfile
from pathlib import Path

from audit_common import ensure_utf8_stdout
from archive import (
    extract_keywords_from_stage_file,
    extract_stage_keywords,
    rebase_markdown_links,
)
from archive.attachment import inject_att_pointer
from archive.cycle import archive_short_term_cycle
from archive.inspect import detect_roadmap_status
from archive.keywords import reindex_archive_keywords

ensure_utf8_stdout()


def run_self_test() -> bool:
    """
    归档链接重写引擎与自测夹具：
    在临时沙箱目录中构造微型施工拓扑，严格验证：
    1. 卷内阶段直连重写（阶段1 -> KALAR-DEV-*-001_阶段1）
    2. 卷内带 ./ 相对直连重写
    3. 同周期跨卷阶段直连重写（../Phase_A/阶段2 -> ../Phase_A/KALAR-DEV-*-002_阶段2）
    4. 泛化外部路径层级升降重写（如 ../../../../config/ 到 ../../../../../config/）
    5. 外部网络链接及锚点保留验证（https://... 与 #L10）
    """
    print("🧪 启动归档重写引擎自测夹具 (Self-Test)...")
    passed_assertions = 0

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        src_vol_a = tmp_path / "docs" / "路线图" / "01_短期施工区" / "Phase_98_模块A"
        src_vol_b = tmp_path / "docs" / "路线图" / "01_短期施工区" / "Phase_99_模块B"
        dst_vol_a = tmp_path / "docs" / "归档库" / "03_短期施工档案卷" / "第10期_91到100" / "Phase_98_模块A"
        dst_vol_b = tmp_path / "docs" / "归档库" / "03_短期施工档案卷" / "第10期_91到100" / "Phase_99_模块B"

        src_vol_a.mkdir(parents=True)
        src_vol_b.mkdir(parents=True)
        dst_vol_a.mkdir(parents=True)
        dst_vol_b.mkdir(parents=True)

        # 外部工程文件
        ext_cfg = tmp_path / "config" / "test.json"
        ext_cfg.parent.mkdir(parents=True)
        ext_cfg.write_text("{}", encoding="utf-8")

        registry = {
            ("Phase_98_模块A", 1): "KALAR-DEV-2026-ST98-001_阶段1_A设计.md",
            ("Phase_98_模块A", 2): "KALAR-DEV-2026-ST98-002_阶段2_A实现.md",
            ("Phase_99_模块B", 1): "KALAR-DEV-2026-ST99-001_阶段1_B设计.md",
            ("Phase_99_模块B", 2): "KALAR-DEV-2026-ST99-002_阶段2_B实现.md",
        }

        test_content = (
            "# 测试细则\n\n"
            "- 卷内直连带锚点: [阶段1设计](阶段1_B设计.md#L10)\n"
            "- 卷内点斜杠直连: [阶段1设计](./阶段1_B设计.md)\n"
            "- 跨卷直连带锚点: [模块A实现](../Phase_98_模块A/阶段2_A实现.md#section)\n"
            "- 外部资源层级重算: [配置](../../../../config/test.json)\n"
            "- 外部网络链接保持: [文档](https://example.com/doc)\n"
        )

        rebased = rebase_markdown_links(test_content, src_vol_b, dst_vol_b, registry, root_dir=tmp_path)

        # 显式断言（不用 assert：python -O 下断言剥离后自测形同虚设）
        checks = [
            ("卷内阶段直连带锚点", "[阶段1设计](KALAR-DEV-2026-ST99-001_阶段1_B设计.md#L10)"),
            ("卷内 ./ 前缀", "[阶段1设计](KALAR-DEV-2026-ST99-001_阶段1_B设计.md)"),
            ("同周期跨卷直连带锚点", "[模块A实现](../Phase_98_模块A/KALAR-DEV-2026-ST98-002_阶段2_A实现.md#section)"),
            ("外部资源层级重算", "[配置](../../../../../config/test.json)"),
            ("外部网络链接保持", "[文档](https://example.com/doc)"),
        ]
        for name, expected in checks:
            if expected not in rebased:
                print(f"  ❌ 自测断言失败: [{name}] 期望 [{expected}] 未出现在重写结果中！实际: {rebased}")
                return False
            passed_assertions += 1

        # 6. 关键词深度归纳提取自测断言（杜绝样板同质化）
        mock_stage_path = tmp_path / "mock_stage1.md"
        mock_stage_path.write_text(
            "# 施工细则：Phase 99 模块B —— 阶段1：核心数据契约设计\n\n"
            "> [!NOTE]\n"
            "> **【施工目标】**：全面构建模块B数据核心：\n"
            "> 1. 设计标准数据模型（`ModuleBManifestDTO` 与 `ModuleBStateDTO`）\n"
            "> 2. 构建核心分群算法（`ModuleBTargetEngine`）\n\n"
            "## 一、 数据结构设计与代码契约\n\n"
            "### 1.1 模块基础契约 (ModuleBManifestDTO)\n\n"
            "```gdscript\n"
            "class_name ModuleBManifestDTO\n"
            "extends RefCounted\n"
            "```\n\n"
            "## 二、 命令式施工执行清单\n\n"
            "## 三、 数据结构验收矩阵\n",
            encoding="utf-8"
        )
        extracted = extract_stage_keywords(mock_stage_path, "Phase_99_模块B", 1, "核心数据契约设计")
        for bp in ["数据结构设计与代码契约", "命令式施工执行清单", "数据结构验收矩阵"]:
            if bp in extracted:
                print(f"  ❌ 关键词断言失败: 样板标题 [{bp}] 未被过滤！提取结果: {extracted}")
                return False
        if "ModuleBManifestDTO" not in extracted:
            print(f"  ❌ 关键词断言失败: 核心实体 ModuleBManifestDTO 未提取！提取结果: {extracted}")
            return False
        passed_assertions += 4

        # 7. 蛇形/驼峰去重与路径/噪声过滤自测断言
        mock_stage2 = tmp_path / "mock_stage2.md"
        mock_stage2.write_text(
            "# 施工细则：Phase 99 模块B —— 阶段2：算法实现\n\n"
            "> [!NOTE]\n"
            "> **【施工目标】**：\n"
            "> 1. 建立资源生命周期管理器（ResourceLifecycleManager / resource_lifecycle_manager.gd）\n"
            "> 2. 引入 scripts/py/audit_common.py 辅助脚本并更新 account.json 注册规则与错误码扩展\n\n"
            "```gdscript\n"
            "class_name ResourceLifecycleManager\n"
            "extends RefCounted\n"
            "```\n",
            encoding="utf-8"
        )
        extracted2 = extract_stage_keywords(mock_stage2, "Phase_99_模块B", 2, "算法实现")
        if "resource_lifecycle_manager" in extracted2 and "ResourceLifecycleManager" in extracted2:
            print("  ❌ 关键词断言失败: ResourceLifecycleManager 与 resource_lifecycle_manager 重复存在！")
            return False
        if "scripts" in [x.lower() for x in extracted2]:
            print("  ❌ 关键词断言失败: 噪声词 scripts 未被过滤！")
            return False
        if "account.json" not in extracted2:
            print(f"  ❌ 关键词断言失败: account.json 未被正确切分提取！提取结果: {extracted2}")
            return False
        passed_assertions += 3

        # 7.1 字符串接口契约断言：头块落盘必须为分号连接字符串，严禁 list repr 泄漏
        joined_kws = extract_keywords_from_stage_file(mock_stage2, "Phase_99_模块B", 2, "算法实现")
        if joined_kws.startswith("[") or joined_kws != "; ".join(extracted2):
            print(f"  ❌ 关键词断言失败: 字符串接口输出非分号连接格式！实际: {joined_kws}")
            return False
        passed_assertions += 1

        # 8. ATT 指针注入三态断言（injected / already_present / anchor_missed）
        att_name = "KALAR-DEV-2026-ST99-ATT_附件_案卷共享契约与上下文.md"

        # 三态一 injected：锚点命中，指针注入成功
        anchor_body = "# 施工细则：测试 —— 阶段1：三态验证\n\n> [!NOTE]\n> **【施工目标】**：验证锚点注入三态。\n\n正文。\n"
        injected, hit_a = inject_att_pointer(anchor_body, att_name)
        if not hit_a or "案卷全局共享上下文" not in injected or att_name not in injected:
            print("  ❌ 锚点断言失败: injected 态未命中或指针未注入！")
            return False
        passed_assertions += 1

        # 三态二 already_present：幂等重入，内容零变化
        reinjected, hit_b = inject_att_pointer(injected, att_name)
        if not hit_b or reinjected != injected:
            print("  ❌ 锚点断言失败: already_present 态破坏幂等（内容发生变化）！")
            return False
        passed_assertions += 1

        # 三态三 anchor_missed：锚点缺失，跳过注入并显式返回未命中
        miss_body = "# 施工细则：测试 —— 阶段1：无锚点样本\n\n普通段落，无【施工目标】引用行。\n"
        untouched, hit_c = inject_att_pointer(miss_body, att_name)
        if hit_c or untouched != miss_body:
            print("  ❌ 锚点断言失败: anchor_missed 态应跳过注入并显式返回未命中！")
            return False
        passed_assertions += 1

    print(f"  ✅ 归档重写、关键词归纳与锚点注入三态自测全部通过 ({passed_assertions}/{passed_assertions} 断言无误)！")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="短期施工区十卷周期归档、打标与总索引精准清理系统")
    parser.add_argument("--detect", action="store_true", help="自动扫描短期施工区与归档库状态及周期进度")
    parser.add_argument("--cycle", action="store_true", help="执行短期施工区满 10 卷周期自动归档")
    parser.add_argument("--apply", action="store_true", help="实际应用归档变更（默认干跑）")
    parser.add_argument("--self-test", action="store_true", help="运行归档链接重写与拓扑映射自测试夹具")
    parser.add_argument("--reindex-keywords", action="store_true", help="根据实际文件内容全量重新归纳提纯归档库关键词并同步总目录")
    parser.add_argument("--cycle-target", type=str, default=None, help="限定重新归纳关键词的目标周期（如 '07' 或留空处理全量）")
    args = parser.parse_args()

    if args.self_test:
        success = run_self_test()
        if not success:
            sys.exit(1)
        return

    if args.reindex_keywords:
        # D1 修复：--apply 恒真表达式（args.apply or True）已消除——
        # 默认干跑仅统计预览，仅显式传入 --apply 时落盘
        success = reindex_archive_keywords(args.cycle_target, apply=args.apply)
        if not success:
            sys.exit(1)
        return

    if args.detect:
        detect_roadmap_status()
        return

    if args.cycle:
        try:
            success = archive_short_term_cycle(args.apply)
        except ValueError as e:
            print(f"  ❌ 【阻断错误】{e}")
            sys.exit(1)
        if not success:
            sys.exit(1)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
