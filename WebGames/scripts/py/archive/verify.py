#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 归档自检验收网)
# 文件路径: WebGames/scripts/py/archive/verify.py
# 架构定位: 归档产物形式验收器 (Archival Artifact Verifier)
# 依赖与触发: 触发方: archive_volume.py | 上游: 归档后目录 | 下游: 校验结论 | 运行时: Python 3.10+
# 职责说明: 严密验证归档产物文件数量、命名规范、导航条闭合度与元数据对齐，提供归档自证
# 退出语义与设计依据: 退出码: 纯校验类无独立退出码 | 设计依据: 归档质量验收闭环契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.verify import verify_volume_integrity
# ==============================================================================
"""verify.py — 案卷阶段特化校验引擎（归档前置门禁）。

执行案卷 4 阶段文件完整性校验、模板占位符拦截与样板化复制检测。"""
import re
from pathlib import Path

from archive.constants import PENDING_CONTEXT_ALLOWLIST, PENDING_MARKER_RE, TEMPLATE_PLACEHOLDER_RE
from archive.metadata import strip_existing_frontmatter


def verify_stage_distinctness(stage_files: list[Path]) -> tuple[bool, str]:
    """
    验证一个卷内 4 个阶段的文件内容是否完全特化：
    1. 自动剥离任何开发态/草稿题头，提取纯正文；
    2. 严禁留存未决占位符（如 <卷主题>、<PREFIX>、待办标记、待填写等）；
    3. 严禁各阶段之间复制粘贴样板代码块。
    """
    if len(stage_files) != 4:
        return False, f"阶段文件数量应为 4，实为 {len(stage_files)}"

    stage_nums = []
    code_blocks = []
    for sf in stage_files:
        text = sf.read_text(encoding="utf-8")
        body_text = strip_existing_frontmatter(text)

        if len(body_text.strip()) < 100:
            return False, f"文件 {sf.name} 正文内容过短 (<100字符)，疑似空文件"

        m = re.search(r"阶段(\d)", sf.name)
        if m:
            stage_nums.append(int(m.group(1)))

        # 扫描未特化模板占位符（模式经 constants 治理配置单源声明）
        template_placeholders = re.findall(TEMPLATE_PLACEHOLDER_RE, body_text)
        if template_placeholders:
            return False, f"文件 {sf.name} 存在未特化的模板占位符: {', '.join(set(template_placeholders))}"

        # 扫描通用未决标记（过滤代码块及行内代码，防止代码与反例测试用例中的 TODO/规则模式误报）
        check_text = re.sub(r"```.*?```", "", body_text, flags=re.DOTALL)
        check_text = re.sub(r"`[^`\n]+`", "", check_text)
        matches = list(re.finditer(PENDING_MARKER_RE, check_text, re.IGNORECASE))
        real_violations = []
        for mat in matches:
            start = max(0, mat.start() - 25)
            end = min(len(check_text), mat.end() + 25)
            context = check_text[start:end]
            if any(kw in context for kw in PENDING_CONTEXT_ALLOWLIST):
                continue
            real_violations.append(mat.group(0))
        if real_violations:
            return False, f"文件 {sf.name} 存在未决占位符: {', '.join(set(real_violations))}"

        codes = re.findall(r"```(?:gdscript|json)?(.*?)```", body_text, re.DOTALL)
        code_body = codes[0].strip() if codes else ""
        code_blocks.append(code_body)

    if sorted(stage_nums) != [1, 2, 3, 4]:
        return False, f"阶段序号不完整或断号: {stage_nums} (应为 [1, 2, 3, 4])"

    for i in range(len(code_blocks)):
        for j in range(i + 1, len(code_blocks)):
            if code_blocks[i] and code_blocks[i] == code_blocks[j]:
                return False, f"阶段 {i+1} 与阶段 {j+1} 代码块完全一致，存在样板化复制！"

    return True, "4 阶段内容完全特化"
