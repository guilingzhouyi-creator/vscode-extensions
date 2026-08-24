#!/usr/bin/env bash
# =============================================================================
# auto-label.sh — Issue/PR 自动分类打标签程序（v2 增强版）
# -----------------------------------------------------------------------------
# 作用：
#   在 Issue 创建/更新（issue.open / issue.update）或 PR 创建/更新（pull_request）
#   时，自动分析标题/描述文本，按关键词规则引擎判定问题/需求【类型】，
#   并幂等打上对应标签。
#
# v2 增强（相对 v1）：
#   - 支持 issue.update 事件：Issue 内容变更后自动重新分类打标签（去旧加新）
#   - 修正规则引擎缺陷：移除易误判的关键词（如 "支持 " 尾随空格、"性能优化" 冲突），
#     新增 安全(security) / 需求规模(epic) 维度
#   - 幂等加固：调用前先删除旧 type/* 标签，再打新标签，避免残留旧类型
#   - 容错加固：CNB API 调用失败不中断整体流程（重试 1 次）
#   - 输出【唤醒提示】：用于串联 NPC 规划者的问题区巡视（仅提示，不擅自 @ 触发）
#
# 配套：
#   - 标签体系文档：.cnb/LABELS.md
#   - 流水线接入：.cnb.yml（$ 下的 issue.open / issue.update / pull_request 事件）
#
# 用法：
#   bash .cnb/scripts/auto-label.sh
#   （依赖 CNB 流水线注入的环境变量 + cnb-cli，仅应在流水线内运行）
#
# 环境变量（由 CNB 流水线自动注入）：
#   Issue 场景：CNB_ISSUE_TITLE / CNB_ISSUE_DESCRIPTION / CNB_ISSUE_IID / CNB_EVENT
#   PR 场景：   CNB_PULL_REQUEST_TITLE / CNB_PULL_REQUEST_DESCRIPTION / CNB_PULL_REQUEST_IID
#   公共：      CNB_REPO_SLUG（组织/仓库）、CNB_PULL_REQUEST（是否 PR）、CNB_EVENT（事件名）
# =============================================================================
set -uo pipefail

# ---------- 0. 基础信息 ----------
REPO_SLUG="${CNB_REPO_SLUG:-}"
IS_PR="${CNB_PULL_REQUEST:-false}"
EVENT="${CNB_EVENT:-}"

# 判定当前是 Issue 还是 PR 场景（PR 优先，兼容事件类型）
if [[ "${IS_PR}" == "true" ]]; then
  MODE="pr"
  TITLE="${CNB_PULL_REQUEST_TITLE:-}"
  DESC="${CNB_PULL_REQUEST_DESCRIPTION:-}"
  NUM="${CNB_PULL_REQUEST_IID:-}"
else
  MODE="issue"
  TITLE="${CNB_ISSUE_TITLE:-}"
  DESC="${CNB_ISSUE_DESCRIPTION:-}"
  NUM="${CNB_ISSUE_IID:-}"
fi

# 若 PR 变量为空但 issue 变量存在，退回 issue 场景（防御）
if [[ -z "${TITLE}" && -n "${CNB_ISSUE_TITLE:-}" ]]; then
  MODE="issue"
  TITLE="${CNB_ISSUE_TITLE}"
  DESC="${CNB_ISSUE_DESCRIPTION:-}"
  NUM="${CNB_ISSUE_IID:-}"
fi

# 判定是否内容变更事件，用于去旧加新
# - issue.update：Issue 内容变更 → 用 put 全量覆盖去旧加新
# - issue.open / pull_request：新建或追加场景 → 用 post 幂等追加，避免误清人工标签
#   （注：pull_request 事件在 PR 创建与更新都会触发，统一用 post 追加最安全，不覆盖人工打的非类型标签）
IS_UPDATE="false"
case "${EVENT}" in
  issue.update) IS_UPDATE="true" ;;
esac

# ---------- 1. 工具函数：小写化 / 包含匹配 ----------
to_lower() { echo "$1" | tr 'A-Z' 'a-z'; }
# contains <haystack> <needle>：不区分大小写判断是否包含
contains() {
  local haystack needle
  haystack="$(to_lower "$1")"
  needle="$(to_lower "$2")"
  [[ "${haystack}" == *"${needle}"* ]]
}

# ---------- 2. 规则引擎：判定主类型 type/*（必选） ----------
# 拼接标题+描述作为匹配文本，用换行分隔避免跨词误判
FULL_TEXT="${TITLE}
${DESC}"

classify_type() {
  local t="$FULL_TEXT"
  # 按优先级依次尝试各类型
  # bug（缺陷）
  for kw in "bug" "异常" "崩溃" "报错" "error" "fail" "crash" "不工作" "无法" "失效" "故障" "死机" "闪退" "错误"; do
    if contains "$t" "$kw"; then echo "type/bug"; return; fi
  done
  # security（安全）—— 放在 feature 之前，避免"安全功能"被误判为新功能
  for kw in "security" "安全" "漏洞" "vuln" "注入" "越权" "权限绕过" "xss" "csrf" "认证" "加密"; do
    if contains "$t" "$kw"; then echo "type/security"; return; fi
  done
  # feature（新功能）
  for kw in "feature" "新功能" "新增" "实现" "需求" "feat"; do
    if contains "$t" "$kw"; then echo "type/feature"; return; fi
  done
  # performance（性能）—— 先于 enhancement，避免"性能优化"误判
  for kw in "性能" "卡顿" "performance" "内存" "慢" "延迟" "提速" "加载速度"; do
    if contains "$t" "$kw"; then echo "type/performance"; return; fi
  done
  # enhancement（增强/优化）
  for kw in "enhance" "优化" "改进" "提升" "增强" "improve" "更好"; do
    if contains "$t" "$kw"; then echo "type/enhancement"; return; fi
  done
  # refactor（重构）
  for kw in "refactor" "重构" "重写" "清理" "cleanup" "整理"; do
    if contains "$t" "$kw"; then echo "type/refactor"; return; fi
  done
  # test（测试）
  for kw in "test" "测试" "用例" "单测" "lint" "coverage" "覆盖率"; do
    if contains "$t" "$kw"; then echo "type/test"; return; fi
  done
  # docs（文档）
  for kw in "docs" "文档" "readme" "说明" "document" "注释"; do
    if contains "$t" "$kw"; then echo "type/docs"; return; fi
  done
  # question（疑问）
  for kw in "?" "？" "怎么" "如何" "请教" "为什么" "question" "疑问"; do
    if contains "$t" "$kw"; then echo "type/question"; return; fi
  done
  # epic（大型需求/里程碑）—— 检测"大需求/里程碑/总体目标"类
  for kw in "epic" "里程碑" "总体" "大盘" "roadmap" "大点" "多阶段" "系列"; do
    if contains "$t" "$kw"; then echo "type/epic"; return; fi
  done
  # chore（杂务/CI，兜底之一）
  for kw in "ci" "构建" "流水线" "依赖" "chore" "脚手架" "npm" "编译"; do
    if contains "$t" "$kw"; then echo "type/chore"; return; fi
  done
  # 全部未命中 → 兜底 chore + 待人工确认
  echo "type/chore"
}
TYPE_LABEL="$(classify_type)"

# ---------- 3. 附带维度判定 ----------
# 3.1 模块 module/*
MODULE_LABEL=""
for kw in "workspace-timing" "计时" "周报" "dashboard" "工作区时长"; do
  if contains "$FULL_TEXT" "$kw"; then MODULE_LABEL="module/workspace-timing"; break; fi
done
if [[ -z "$MODULE_LABEL" ]]; then
  for kw in "npc" "约定" "唤醒" "规划" "花名册" "路线图" "调度"; do
    if contains "$FULL_TEXT" "$kw"; then MODULE_LABEL="module/npc"; break; fi
  done
fi
if [[ -z "$MODULE_LABEL" ]]; then
  for kw in "ci" "流水线" "构建" ".cnb"; do
    if contains "$FULL_TEXT" "$kw"; then MODULE_LABEL="module/ci"; break; fi
  done
fi
if [[ -z "$MODULE_LABEL" ]]; then
  for kw in "docs" "文档" "readme"; do
    if contains "$FULL_TEXT" "$kw"; then MODULE_LABEL="module/docs"; break; fi
  done
fi

# 3.2 范围 scope/*
SCOPE_LABEL="scope/${MODE}"

# 3.3 优先级 priority/*（默认 medium；明显紧急→high/urgent）
PRIORITY_LABEL="priority/medium"
for kw in "紧急" "urgent" "阻塞" "crash" "崩溃" "生产" "必须" "p0" "严重"; do
  if contains "$FULL_TEXT" "$kw"; then PRIORITY_LABEL="priority/high"; break; fi
done
for kw in "p0" "urgent" "立即" "紧急修复" "down" "事故" "宕机"; do
  if contains "$FULL_TEXT" "$kw"; then PRIORITY_LABEL="priority/urgent"; break; fi
done

# 3.4 兜底标记：若类型为兜底 chore 且无明确关键词 → 附 status/triage
STATUS_LABEL=""
if [[ "$TYPE_LABEL" == "type/chore" && -z "$MODULE_LABEL" ]]; then
  STATUS_LABEL="status/triage"
fi

# ---------- 4. 组装标签列表 ----------
LABELS=("$TYPE_LABEL" "$SCOPE_LABEL" "$PRIORITY_LABEL")
[[ -n "$MODULE_LABEL" ]] && LABELS+=("$MODULE_LABEL")
[[ -n "$STATUS_LABEL" ]] && LABELS+=("$STATUS_LABEL")

# 去重（保序）
declare -A _seen
DEDUP=()
for lb in "${LABELS[@]}"; do
  if [[ -z "${_seen[$lb]:-}" ]]; then
    _seen[$lb]=1
    DEDUP+=("$lb")
  fi
done

echo "========== 自动分类打标签 =========="
echo "模式   : ${MODE} (编号 #${NUM}) 事件=${EVENT}"
echo "标题   : ${TITLE}"
echo "主类型 : ${TYPE_LABEL}"
echo "标签   : ${DEDUP[*]}"

# ---------- 5. 校验环境，避免空跑 ----------
if [[ -z "$REPO_SLUG" || -z "$NUM" ]]; then
  echo "⚠️ 缺少仓库或编号环境变量（REPO_SLUG=${REPO_SLUG:-空}, NUM=${NUM:-空}），跳过打标签。"
  exit 0
fi

# ---------- 6. 调用 CNB API 幂等打标签 ----------
# 6.1 内容变更事件 → 先清理旧的 type/* 标签，避免类型残留
# 通过 put-issue-labels（全量设置）实现：先查询当前标签，过滤掉旧的 type/* 与 status/triage，
# 仅保留非类型标签（priority/scope/module），再与本次新标签合并后全量写入。
# 这样既去旧加新，又保留人工打的优先级/模块标签，且幂等。
if [[ "$IS_UPDATE" == "true" && "$MODE" == "issue" ]]; then
  echo "--- 内容变更事件，清理旧 type/* 标签（保留人工打的非类型标签） ---"
  # 查询当前 Issue 标签
  CUR_LABELS=$(cnb issues list-issue-labels --repo "$REPO_SLUG" --number "$NUM" 2>/dev/null | tr -d '\[\]" ' | tr ',' '\n' || true)
  KEEP=()
  if [[ -n "$CUR_LABELS" ]]; then
    while IFS= read -r lb; do
      # 仅保留非 type/* 且非 status/triage 的标签（人工维度的优先级/模块/范围）
      case "$lb" in
        type/*|status/triage|status/todo|status/in-progress|status/blocked|status/done|status/invalid) ;; # 丢弃
        *) [[ -n "$lb" ]] && KEEP+=("$lb") ;;
      esac
    done <<< "$CUR_LABELS"
  fi
fi

# 合并保留标签 + 本次新标签（去重保序）
declare -A _seen2
MERGE=()
for lb in "${KEEP[@]:-}" "${DEDUP[@]}"; do
  if [[ -n "$lb" && -z "${_seen2[$lb]:-}" ]]; then
    _seen2[$lb]=1
    MERGE+=("$lb")
  fi
done

# 全量设置（幂等）：若为内容变更，用 MERGE 全量覆盖；否则仅追加新标签
PUT_MODE="false"
if [[ "$IS_UPDATE" == "true" ]]; then
  PUT_MODE="true"
fi

# 6.2 打标签（幂等；内容变更用 put 全量覆盖，新增用 post 追加）
# 全量覆盖场景：内容变更时用 put-*-labels（设置，覆盖全部）；新增场景用 post-*-labels（追加）
ARGS=(--repo "$REPO_SLUG" --number "$NUM")
if [[ "$PUT_MODE" == "true" ]]; then
  # 全量设置：保留标签 + 本次新标签合并结果
  for lb in "${MERGE[@]:-}"; do
    ARGS+=(--labels "$lb")
  done
else
  for lb in "${DEDUP[@]}"; do
    ARGS+=(--labels "$lb")
  done
fi

RET=1
# 失败重试 1 次
for attempt in 1 2; do
  if [[ "$MODE" == "pr" ]]; then
    if [[ "$PUT_MODE" == "true" ]]; then
      cnb pulls put-pull-labels "${ARGS[@]}" >/dev/null 2>&1
    else
      cnb pulls post-pull-labels "${ARGS[@]}" >/dev/null 2>&1
    fi
    RET=$?
  else
    if [[ "$PUT_MODE" == "true" ]]; then
      cnb issues put-issue-labels "${ARGS[@]}" >/dev/null 2>&1
    else
      cnb issues post-issue-labels "${ARGS[@]}" >/dev/null 2>&1
    fi
    RET=$?
  fi
  [[ $RET -eq 0 ]] && break
  echo "⚠️ 第 ${attempt} 次打标签调用返回非 0（$RET），重试..."
done

if [[ $RET -eq 0 ]]; then
  echo "✅ 已为 ${MODE} #${NUM} 打上标签：${DEDUP[*]}"
else
  echo "⚠️ 打标签调用多次返回非 0（$RET），可能是标签已存在（幂等）或权限受限，继续后续流程。"
fi

# 输出【打标签结论】供流水线日志/评论引用
echo "【打标签结论】${MODE} #${NUM} 类型=${TYPE_LABEL} 标签=${DEDUP[*]}"

# ---------- 6.5 发布触发联动判断（串联 release.sh · R2 打标发布自动化） ----------
# 在【打标签结论】后串联「发布自动化」触发判断。
# 发布仅在 PR 合入门禁全绿后触发（与 pr-gate.sh / pull_request 联动）：
#   - PR 未合入（pull_request 创建/更新）→ 不触发发布，仅输出待发布提示；
#   - PR 合入后（pull_request.merged）且命中发布类标签 → 提示串联 release.sh。
# 本脚本仅输出结构化提示，不在此擅自实际触发发布（发布判定交由 release.sh 做门禁全绿+幂等检查）。
RELEASE_TRIGGER="false"
for lb in "${DEDUP[@]:-}"; do
  case "$lb" in
    status/ready|type/feature|type/enhancement)
      RELEASE_TRIGGER="true" ;;
  esac
done
if [[ "$RELEASE_TRIGGER" == "true" ]]; then
  echo "【发布触发】${MODE} #${NUM} 命中发布类标签（${DEDUP[*]}）。"
  if [[ "$EVENT" == "pull_request.merged" || "$EVENT" == "tag_push" || "$EVENT" == "web_trigger" ]]; then
    echo "   事件为 ${EVENT}，门禁全绿后可串联发布：bash .cnb/scripts/release.sh（幂等去重 + 失败重试 + 超时兜底）。"
  else
    echo "   当前事件为 ${EVENT}（PR 未合入门禁），发布不触发；待 PR 合入门禁全绿后由 release.sh 判断。"
  fi
fi

# ---------- 7. 唤醒提示（串联 NPC 规划者问题区巡视，仅提示不擅自 @ 触发） ----------
# 依据索引：NPC 互 @ 不可靠，规划者问题区巡视由代码事件/web_trigger 确定性触发。
# 此处仅输出结构化提示，供规划者在事件驱动（pull_request/web_trigger）时读取，
# 识别挂起项（无响应/未排入/过期/重复/阻塞）并推动，不在此脚本内用评论 @ 触发。
echo "【唤醒提示】${MODE} #${NUM} 已完成自动分类打标签（类型=${TYPE_LABEL}）。"
echo "规划者可通过确定性通道（pull_request / web_trigger）接手：巡视该 ${MODE} 是否需排入路线图或关闭/重启。"

exit 0
