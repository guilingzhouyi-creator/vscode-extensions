#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 档案元数据常量)
# 文件路径: WebGames/scripts/py/archive/constants.py
# 架构定位: 档案配置与路径常量底座 (Archive Constants Base)
# 依赖与触发: 触发方: archive 模块全域 | 上游: 标准库 | 下游: 归档调度器 | 运行时: Python 3.10+
# 职责说明: 定义归档库物理根路径、案卷卷号格式化模板、历史案卷区间映射与国家标准元数据字典
# 退出语义与设计依据: 退出码: 常量模块无退出码 | 设计依据: 档案管理唯一事实源契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.constants import ARCHIVE_ROOT, VOLUME_FORMAT
# ==============================================================================
"""constants.py — 归档系统路径常量与治理配置单一真源。

定义全宗归档路径、分类元数据 Schema、头块模板与注入锚点约定。"""
from dataclasses import dataclass
from pathlib import Path

from audit_common import KALAR_DEV_PREFIX, resolve_repo_root

ROOT = resolve_repo_root()
DOCS_DIR = ROOT / "docs"
ROADMAP_DIR = DOCS_DIR / "路线图"
SHORT_TERM_DIR = ROADMAP_DIR / "01_短期施工区"
LONG_TERM_DIR = ROADMAP_DIR / "02_长期演进区"
ARCHIVE_DIR = DOCS_DIR / "归档库"
RM_ARCHIVE_DIR = ARCHIVE_DIR / "01_施工路线图档案卷"
FE_ARCHIVE_DIR = ARCHIVE_DIR / "02_前端施工档案卷"
ST_ARCHIVE_DIR = ARCHIVE_DIR / "03_短期施工档案卷"
MASTER_CATALOG = ARCHIVE_DIR / "卡拉尔全宗档案总目录与元数据库.md"
ROADMAP_INDEX = ROADMAP_DIR / "路线图总索引.md"
ARCHIVE_README = ARCHIVE_DIR / "README.md"
TESTS_DIR = ROOT / "tests" / "unit"

# 统一归档分类配置元数据 Schema
ARCHIVE_CATEGORIES = {
    "DEV-RM": {
        "name": "施工路线图",
        "dir_name": "01_施工路线图档案卷",
        "code_prefix": "RM",
        "default_responsible": "卡拉尔世界引擎架构组",
        "cycle_size": 0,
    },
    "DEV-FE": {
        "name": "前端施工档案",
        "dir_name": "02_前端施工档案卷",
        "code_prefix": "FE",
        "default_responsible": "卡拉尔世界引擎前端组",
        "cycle_size": 0,
    },
    "DEV-ST": {
        "name": "短期施工周期归档",
        "dir_name": "03_短期施工档案卷",
        "code_prefix": "ST",
        "default_responsible": "卡拉尔世界引擎架构组",
        "cycle_size": 10,
    }
}

# --- 归档治理配置（Phase 79 配置化提纯：硬编码收敛单一真源） ---

@dataclass(frozen=True)
class ArchiveHeaderTemplate:
    """14 项档案头块模板契约：年度槽位由归档日期推导注入，严禁字面年份"""
    frontmatter_template: str   # 含 {annual_year} 槽位
    att_frontmatter_template: str  # ATT 附件头块模板

# 责任者显式映射（替代 "前端" in name 启发式的配置化声明）
RESPONSIBLE_MAP = {
    "前端": "卡拉尔世界引擎前端组",
}
RESPONSIBLE_DEFAULT = "卡拉尔世界引擎架构组"

# 全宗总目录登记用责任者简称映射
RESPONSIBLE_SHORT_MAP = {
    "前端": "前端组",
    "架构": "架构组",
}
RESPONSIBLE_SHORT_DEFAULT = "架构组"

# --- 关键词提取治理配置（Phase 79 配置化提纯：keywords.py 停用词/样板词单一真源） ---

BOILERPLATE_BLACK_LIST = {
    "数据结构设计与代码契约", "数据结构设计与契约模型", "数据结构验收矩阵",
    "核心算法与业务实现", "核心算法与业务细类实现", "业务功能初步验证矩阵",
    "配置驱动与接线", "配置驱动分流与全域现代调用接口改造工程化",
    "配置表扩充与热重载广播", "配置驱动与工程化接入", "工程化接入验证矩阵",
    "测试用例集与验收断言矩阵", "测试用例清单与第一性原理断言矩阵",
    "命令式施工执行清单", "阶段交付物清单", "DoD 验收闭环",
    "第一性原理溯源指针", "精准上游规范指针", "核心不变量约束断言",
    "防漂移最高指示", "实施清单", "验收矩阵", "核心测试用例清单",
    "测试用例与断言矩阵", "测试套件入口与全量执行报告",
    "案卷全局上下文", "领域术语字典", "共享不变量", "公共Mock数据契约",
    "阶段施工执行清单", "核心数据模型与代码契约", "配置驱动与工程化接线",
    "配置驱动接入与工程化", "验收测试矩阵与质量门禁", "验收测试矩阵与工程闭环",
    "测试矩阵与工程闭环", "全量验收测试矩阵与工程闭环", "全量验收与工程闭环",
    "数据模型契约用例", "验收测试矩阵", "全量验收测试矩阵", "测试矩阵"
}

STOP_CLASSES = {
    "RefCounted", "Node", "Object", "Variant", "Round", "Array", "Dictionary",
    "String", "int", "float", "bool", "Vector2", "Vector3", "Color", "Callable"
}

NOISE_WORDS = {
    "scripts", "bash", "gdscript", "python", "timestamp", "consume", "auth",
    "test", "tests", "helper", "helpers", "util", "utils", "temp", "tmp",
    "mock", "mocks", "patch", "patches", "step", "impl", "todo", "tbd",
    "pass", "fail", "null", "none", "true", "false", "item", "data",
    "void", "var", "func", "const", "enum", "signal", "extends", "config",
    "configs", "name", "names", "reader", "writer", "core", "main", "sub",
    "base", "parent", "child", "node", "archive_volume", "audit_common"
}

# --- 案卷特化校验治理配置（Phase 79 配置化提纯：verify.py 拦截模式单一真源） ---

# 未特化模板占位符拦截模式
TEMPLATE_PLACEHOLDER_RE = (
    r"<(?:卷主题|PREFIX|NN|YYYY-MM-DD|上游需求文档相对链接|章节锚点|阶段\d主题|阶段具体目标"
    r"|配置表名|字段名|类名|domain_path|entity_file|Domain|Entity|Method|Service|TableName)>"
)
# 通用未决标记拦截模式
PENDING_MARKER_RE = r"\b(?:TODO|TBD|待填写|待编写|待补充|待定义|待实现|MyDataDTO)\b"
# 未决标记上下文豁免词（防反例/禁令样本误报）
PENDING_CONTEXT_ALLOWLIST = ("禁止", "零未决", "反例", "样例", "注入", "违规", "检出", "禁令", "规避")


def _match_responsible_short(text: str) -> str | None:
    """责任者简称映射命中查询（未命中返回 None，便于区分「命中默认值」与「未命中」）"""
    for keyword, responsible in RESPONSIBLE_SHORT_MAP.items():
        if keyword in text:
            return responsible
    return None


def resolve_responsible_short_from_context(resp_raw: str, *path_hints: str) -> str:
    """责任者简称解析链（配置单源，无字段字面启发式）：

    ① frontmatter 原文命中映射 → 直接返回；
    ② 依次检查路径提示命中映射 → 返回首个命中；
    ③ 均未命中且存在显式自定义值 → 原样保留；
    ④ 否则回退默认简称。
    """
    hit = _match_responsible_short(resp_raw)
    if hit is not None:
        return hit
    for hint in path_hints:
        if not hint:
            continue
        hit = _match_responsible_short(hint)
        if hit is not None:
            return hit
    return resp_raw or RESPONSIBLE_SHORT_DEFAULT



@dataclass(frozen=True)
class AnchorConventions:
    """注入锚点约定声明（唯一真源）：attachment.py 仅消费引用，严禁函数体字面正则"""
    att_pointer_anchor: str        # ATT 指针插入锚：优先命中【施工目标】引用行
    navbar_note_anchor: str        # navbar 注入锚：[!NOTE] 块定位
    navbar_fallback_h1: str        # 一级标题回退定位模式
    att_pointer_marker: str        # ATT 指针幂等标记串
    att_pointer_alt_marker: str    # ATT 指针幂等备选标记串
    navbar_marker: str             # navbar 幂等标记串


ANCHOR_CONVENTIONS = AnchorConventions(
    att_pointer_anchor=r"(> \*\*【施工目标】\*\*：[^\n]+)",
    navbar_note_anchor="> [!NOTE]",
    navbar_fallback_h1=r"(# [^\n]+\n)",
    att_pointer_marker="案卷全局共享上下文",
    att_pointer_alt_marker="案卷共享契约与上下文附件",
    navbar_marker="> 📍 **卷内快速直达**：",
)


@dataclass(frozen=True)
class ArchiveGovernanceConfig:
    """归档治理配置聚合：头块模板 + 责任者解析 + 周期参数"""
    header_template: ArchiveHeaderTemplate
    cycle_size_default: int = 10


def resolve_responsible(vol_name: str) -> str:
    """按治理配置映射解析案卷责任者（关键词显式命中，否则默认值）"""
    for keyword, responsible in RESPONSIBLE_MAP.items():
        if keyword in vol_name:
            return responsible
    return RESPONSIBLE_DEFAULT


def resolve_responsible_short(vol_name: str) -> str:
    """按治理配置映射解析案卷责任者简称（供全宗总目录登记行使用）"""
    for keyword, responsible in RESPONSIBLE_SHORT_MAP.items():
        if keyword in vol_name:
            return responsible
    return RESPONSIBLE_SHORT_DEFAULT


def build_header_template(annual_year: str) -> str:
    """由归档年度动态生成 14 项档案头块模板（D3 修复：年度不再硬编码）"""
    return f"""---
档号: {{archive_code}}
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: {annual_year}
案卷号: {{st_id}} ({{vol_name}})
件号: {{piece}}
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: {{responsible}}
题名: {{vol_name}} —— 阶段{{stage_num}}：{{stage_title}}
形成日期: {{formation_date}}
归档日期: {{archive_date}}（{{archive_period}}）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: {{keywords}}
---

"""


def build_att_header_template(annual_year: str) -> str:
    """由归档年度动态生成 ATT 附件档案头块模板"""
    return f"""---
档号: {{archive_code}}
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·案卷共享附件)
年度: {annual_year}
案卷号: {{st_id}} ({{vol_name}})
件号: ATT
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: {{responsible}}
题名: {{vol_name}} —— 案卷共享契约与全局上下文附件
形成日期: {{formation_date}}
归档日期: {{archive_date}}
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: {{keywords}}
---

"""
