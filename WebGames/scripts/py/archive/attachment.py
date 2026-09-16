#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 附件与卷标治理)
# 文件路径: WebGames/scripts/py/archive/attachment.py
# 架构定位: 档案导航与卷标生成器 (Archive Navigation Builder)
# 依赖与触发: 触发方: archive_volume.py | 上游: docs/路线图/01_短期施工区 | 下游: 归档案卷 Markdown | 运行时: Python 3.10+
# 职责说明: 处理案卷附件关联、卷内阶段文件序号重编与顶部/底部双向导航浮标注入
# 退出语义与设计依据: 退出码: 纯业务方法无独立退出码 | 设计依据: 档案完整性与可溯源性契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.attachment import inject_volume_navbars
# ==============================================================================
"""attachment.py — 案卷共享附件 (ATT) 生成与卷内导航浮标注入引擎。

负责为归档案卷生成第 5 份共享契约上下文附件及双向快速导航浮标。"""
import re
from pathlib import Path

from archive.constants import ANCHOR_CONVENTIONS, KALAR_DEV_PREFIX, build_att_header_template, resolve_responsible
from archive.keywords import extract_att_keywords
from archive.metadata import minify_markdown_text, resolve_file_formation_date


def generate_volume_attachment(dst_vol_dir: Path, st_id: str, vol_name: str, today: str, annual_year: str = "") -> Path:
    """生成案卷级第 5 份共享契约与全局上下文附件 (ATT)。annual_year 由归档日期推导注入。"""
    att_filename = f"{KALAR_DEV_PREFIX}-{st_id}-ATT_附件_案卷共享契约与上下文.md"
    att_path = dst_vol_dir / att_filename

    if att_path.exists():
        return att_path

    annual_year = annual_year or f"{today[:4]}年"
    clean_title = re.sub(r"^Phase_\d+_", "", vol_name).replace("_", " ")
    responsible = resolve_responsible(vol_name)

    # 扫描本卷所有阶段正文提取施工目标与最早落盘形成日期
    stages = sorted([s for s in dst_vol_dir.glob("*.md") if "ATT" not in s.name and "阶段" in s.name])
    all_text = "\n".join([s.read_text(encoding="utf-8") for s in stages]) if stages else ""
    goals = re.findall(r"(?:【施工目标】|【核心职责】)[：:]\s*(.+?)(?:\n|>|$)", all_text)
    goal_summary = "；".join(list(dict.fromkeys(goals))[:3]) if goals else f"完成 {clean_title} 四阶段架构施工与表现层闭环"

    stage_dates = [resolve_file_formation_date(s) for s in stages] if stages else []
    formation_date = min(stage_dates) if stage_dates else today

    # 动态根据本卷实际内容归纳特化主题词
    att_kws = extract_att_keywords(dst_vol_dir, vol_name, st_id)
    att_keywords_str = "; ".join(att_kws)

    # 头块模板经 constants 配置单源构建（年度槽位动态注入，严禁字面年份）
    att_header = build_att_header_template(annual_year).format(
        archive_code=f"{KALAR_DEV_PREFIX}-{st_id}-ATT",
        st_id=st_id,
        vol_name=vol_name,
        responsible=responsible,
        formation_date=formation_date,
        archive_date=today,
        keywords=att_keywords_str,
    )
    att_body = f"""# 案卷共享附件：{vol_name} —— 全局上下文与公共契约

> [!NOTE]
> **【附件定位】**：本文件为案卷 `{st_id}`（{clean_title}）的唯一共享上下文事实源（Single Source of Shared Truth）。
> 集中承载跨阶段 1~4 复用的**领域术语定义、上游需求溯源、共享架构不变量与公共契约**。
> 各阶段细则直接引用本附件，实现正文 Token 致密化提纯与无歧义语义收敛。

---

## 📌 一、 案卷定位与上游需求溯源 (Domain Context & Scope)

* **所属案卷主题**：`{vol_name}`
* **上游架构需求溯源**：[后端/前端架构需求表索引](../../../../后端架构/后端架构需求表索引.md)
* **核心交付目标**：{goal_summary}
* **设计不变量断言**：`本案卷全链路遵循单机确定性、零硬编码、数据模型隔离与全量配置驱动原则`。

---

## 📖 二、 领域名词与术语字典 (Domain Glossary)

| 领域术语 / 枚举常量 | 业务语义与定位 | 约束与副作用 |
| :--- | :--- | :--- |
| `STAGE_DTO` | 阶段数据传输契约模型 | 字段严格校验，强类型强约束 |
| `RESOLVER` | 核心算法与状态跃迁求解器 | 纯函数/确定性计算，错误码留痕 |
| `CONFIG_BIND` | 配置表动态注入驱动 | 零硬编码，支持热重载广播 |
| `DOD_GUARD` | Definition of Done 验收矩阵 | 单元测试 100% 覆盖，白模无崩溃 |

---

## 🏛️ 三、 共享不变量与跨阶段拓扑契约 (Shared Invariants & Architecture Contracts)

```mermaid
flowchart LR
    A[阶段1: 数据契约 DTO] --> B[阶段2: 业务逻辑求解器]
    B --> C[阶段3: 配置驱动接入]
    C --> D[阶段4: DoD 单元测试矩阵]

    style A fill:#e1f5fe,stroke:#0288d1
    style B fill:#e8f5e9,stroke:#388e3c
    style C fill:#fff3e0,stroke:#f57c00
    style D fill:#f3e5f5,stroke:#7b1fa2
```

1. **单机确定性不变量**：业务计算必须具备确定性结果，严禁隐式全局随机；
2. **零硬编码契约**：所有数值、枚举、文本、阈值全部收敛至 `config/` 对应数据表；
3. **数据隔离边界**：状态聚合根由专属领域服务托管，跨域交互经 EventBus 广播解耦。
"""
    att_path.write_text(minify_markdown_text(att_header + att_body), encoding="utf-8", newline="\n")
    return att_path


def inject_att_pointer(content: str, att_name: str) -> tuple[str, bool]:
    """向阶段正文注入 ATT 共享附件指针（锚点经 AnchorConventions 单源声明）。

    返回 (新内容, 是否命中锚点)。幂等：已含任一标记串时原样返回。
    """
    conv = ANCHOR_CONVENTIONS
    if conv.att_pointer_marker in content or conv.att_pointer_alt_marker in content:
        return content, True

    note_pattern = re.compile(conv.att_pointer_anchor)
    if note_pattern.search(content):
        replacement = r"\1\n> **案卷全局共享上下文**：👉 [" + att_name + "](" + att_name + ")。"
        return note_pattern.sub(replacement, content, count=1), True
    return content, False


def inject_volume_navbars(vol_dir: Path, st_id: str) -> None:
    """自动为案卷内的 5 份文档（ATT + 4阶段）注入卷内直达导航浮标（锚点经 AnchorConventions 单源声明）"""
    conv = ANCHOR_CONVENTIONS
    att_files = list(vol_dir.glob("*ATT*.md"))
    att_name = att_files[0].name if att_files else ""
    stages = sorted([f for f in vol_dir.glob("*.md") if "阶段" in f.name and "ATT" not in f.name])
    all_files = (att_files if att_files else []) + stages

    for f in all_files:
        content = f.read_text(encoding="utf-8")
        nav_items = []
        if att_name:
            if f.name == att_name:
                nav_items.append("**ATT 共享附件 (当前)**")
            else:
                nav_items.append(f"[ATT 共享附件]({att_name})")

        for sf in stages:
            m = re.search(r"阶段(\d)", sf.name)
            s_num = m.group(1) if m else "?"
            if f.name == sf.name:
                nav_items.append(f"**阶段{s_num} (当前)**")
            else:
                nav_items.append(f"[阶段{s_num}]({sf.name})")

        navbar_line = conv.navbar_marker + " ｜ ".join(nav_items)

        navbar_re = re.compile(r"(?m)^\s*" + re.escape(conv.navbar_marker) + r"[^\r\n]*")
        if navbar_re.search(content):
            content = navbar_re.sub(navbar_line, content)
        elif conv.navbar_note_anchor in content:
            lines = content.split("\n")
            new_lines = []
            in_note = False
            inserted = False
            for ln in lines:
                new_lines.append(ln)
                if ln.startswith(conv.navbar_note_anchor):
                    in_note = True
                elif in_note and not ln.startswith(">"):
                    in_note = False
                    if not inserted:
                        new_lines.insert(len(new_lines) - 1, navbar_line)
                        inserted = True
            if not inserted:
                new_lines.append(navbar_line)
            content = "\n".join(new_lines)
        else:
            content = re.sub(conv.navbar_fallback_h1, r"\1\n" + navbar_line + "\n", content, count=1)

        f.write_text(minify_markdown_text(content), encoding="utf-8", newline="\n")
