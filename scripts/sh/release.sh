#!/usr/bin/env bash
# =============================================================================
# release.sh — 打标后发布自动化骨架（R2 · 意图 #17 M2）
# -----------------------------------------------------------------------------
# 作用：
#   在「打标 + PR 合入门禁全绿」后，触发并执行发布流程。承接 workspace-timing
#   现有发布路径，作为发布自动化的统一骨架：
#     ① 发布触发判断：仅在 PR 合入门禁全绿后触发（与 pr-gate.sh / pull_request 联动）
#     ② 幂等去重：同版本不重复发布（tag 已存在则跳过）
#     ③ 失败重试：post-release 失败自动重试 N 次
#     ④ 超时兜底：分步 + 总超时，超时按升级链（执行体→审查→规划→管理员）上移
#
# 配套：
#   - auto-label.sh v2：输出【打标签结论】，本脚本据此 + 门禁全绿判定发布触发
#   - pr-gate.sh：输出【门禁结论】并打 status/gate-ok（门禁全绿标志）
#   - 流水线接入：.cnb.yml（pull_request.merged / web_trigger / tag_push 事件）
#
# 用法：
#   bash scripts/sh/release.sh
#   （依赖 CNB 流水线注入的环境变量 + cnb-cli，仅应在流水线内运行）
#
# 环境变量（由 CNB 流水线自动注入）：
#   CNB_REPO_SLUG    组织/仓库（必填）
#   CNB_EVENT        事件名（发布仅在 pull_request.merged 等合入门禁全绿后触发）
#   CNB_PULL_REQUEST_IID  PR 编号（用于门禁全绿校验）
#   CNB_DEFAULT_BRANCH    目标分支
#   可选覆盖：RELEASE_MODULE / RELEASE_VERSION（指定发布模块/版本；缺省自动从 package.json 读取）
# =============================================================================
set -uo pipefail

# ---------- 0. 基础配置 ----------
REPO_SLUG="${CNB_REPO_SLUG:-}"
EVENT="${CNB_EVENT:-}"
PR_NUM="${CNB_PULL_REQUEST_IID:-}"
DEFAULT_BRANCH="${CNB_DEFAULT_BRANCH:-main}"

# 发布模块目录（缺省为仓库根；多包仓库通过 RELEASE_MODULE 指定子目录）
RELEASE_MODULE="${RELEASE_MODULE:-}"
# 发布模块名 / 版本号（缺省自动解析）
RELEASE_NAME="${RELEASE_NAME:-}"
RELEASE_VERSION="${RELEASE_VERSION:-}"

# 幂等去重（同版本不重复发布）
IDEMPOTENT="${IDEMPOTENT:-true}"
# 失败重试次数
MAX_RETRY="${MAX_RETRY:-3}"
# 单步超时（秒）与总超时（秒）
STEP_TIMEOUT="${STEP_TIMEOUT:-120}"
TOTAL_TIMEOUT="${TOTAL_TIMEOUT:-600}"

# 门禁全绿标志（pr-gate.sh 打出）
GATE_OK_LABEL="status/gate-ok"
# 发布允许的触发事件（PR 合入门禁全绿后）
ALLOWED_EVENTS="pull_request.merged tag_push web_trigger api_trigger_npc"

# 发布标签（auto-label.sh 打标结论中出现的发布触发标签）
RELEASE_LABEL="status/ready"

# ---------- 1. 预检环境 ----------
if [[ -z "$REPO_SLUG" ]]; then
  echo "⚠️ release: 缺少仓库环境变量（CNB_REPO_SLUG 为空），跳过发布。"
  exit 0
fi

echo "================= 发布自动化（release.sh） ================="
echo "仓库     : ${REPO_SLUG}"
echo "事件     : ${EVENT:-（未识别）}"
echo "PR 编号  : ${PR_NUM:-（非 PR 场景）}"
echo "目标分支 : ${DEFAULT_BRANCH}"

# ---------- 2. 发布触发判断（门禁全绿后才触发） ----------
# 发布仅在 PR 合入门禁全绿后触发；与 pr-gate.sh / pull_request 联动。
# 门禁全绿条件：事件为合入后事件，且（若为 PR 场景）该 PR 已打 status/gate-ok 标签。

# 2.1 事件白名单
ALLOWED=0
for ev in $ALLOWED_EVENTS; do
  if [[ "$EVENT" == "$ev" ]]; then
    ALLOWED=1
    break
  fi
done

if [[ "$ALLOWED" -eq 0 ]]; then
  echo "🛑 release: 事件「${EVENT:-空}」不在发布允许白名单（${ALLOWED_EVENTS}）内。"
  echo "   发布仅在 PR 合入门禁全绿后触发。本次跳过。"
  echo "【发布结论】跳过：触发事件不符合门禁全绿发布条件。"
  exit 0
fi

# 2.2 PR 场景下校验门禁全绿（status/gate-ok 标签）
if [[ -n "$PR_NUM" ]]; then
  echo "--- 校验 PR #${PR_NUM} 门禁全绿（${GATE_OK_LABEL} 标签） ---"
  CUR_LABELS=$(cnb pulls list-labels --repo "$REPO_SLUG" --number "$PR_NUM" 2>/dev/null | tr -d '\[\]" ' | tr ',' '\n' || true)
  GATE_OK=0
  if [[ -n "$CUR_LABELS" ]]; then
    while IFS= read -r lb; do
      if [[ "$lb" == "$GATE_OK_LABEL" ]]; then
        GATE_OK=1
        break
      fi
    done <<< "$CUR_LABELS"
  fi
  if [[ "$GATE_OK" -eq 0 ]]; then
    echo "🛑 release: PR #${PR_NUM} 未打 ${GATE_OK_LABEL} 标签，门禁未全绿，禁止发布。"
    echo "   请先通过 pr-gate.sh 门禁（冲突检测 + Diff 初筛全绿）后再触发发布。"
    echo "【发布结论】跳过：PR 门禁未全绿。"
    exit 0
  fi
  echo "✅ PR #${PR_NUM} 门禁全绿（已打 ${GATE_OK_LABEL}）。"
fi

# ---------- 3. 解析发布模块与版本 ----------
# 3.1 定位发布模块目录
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "$RELEASE_MODULE" ]]; then
  MODULE_DIR="${BASE_DIR}/${RELEASE_MODULE}"
else
  # 缺省：若仓库根无 package.json，尝试 workspace-timing（既有发布路径）
  if [[ -f "${BASE_DIR}/package.json" ]]; then
    MODULE_DIR="$BASE_DIR"
  elif [[ -f "${BASE_DIR}/workspace-timing/package.json" ]]; then
    MODULE_DIR="${BASE_DIR}/workspace-timing"
  else
    echo "⚠️ release: 未找到发布模块（无 package.json），请通过 RELEASE_MODULE 指定。"
    echo "【发布结论】跳过：发布模块不存在。"
    exit 0
  fi
fi

# 3.2 解析名称与版本
if [[ -z "$RELEASE_NAME" || -z "$RELEASE_VERSION" ]]; then
  PKG_JSON="${MODULE_DIR}/package.json"
  if [[ ! -f "$PKG_JSON" ]]; then
    echo "⚠️ release: ${PKG_JSON} 不存在，无法解析版本。"
    echo "【发布结论】跳过：缺少 package.json。"
    exit 0
  fi
  [[ -z "$RELEASE_NAME" ]] && RELEASE_NAME=$(grep '"name"' "$PKG_JSON" | head -1 | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
  [[ -z "$RELEASE_VERSION" ]] && RELEASE_VERSION=$(grep '"version"' "$PKG_JSON" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
fi

# Tag 规范与 GitHub 体系对齐：<模块名>-vX.Y.Z（如 workspace-timing-v0.4.1），避免两平台对同一发布打出不同 Tag
MODULE_NAME="$(basename "$MODULE_DIR")"
TAG_NAME="${MODULE_NAME}-v${RELEASE_VERSION}"
echo "发布模块 : ${RELEASE_NAME:-（未解析）}"
echo "发布版本 : ${RELEASE_VERSION}"
echo "目标标签 : ${TAG_NAME}"

if [[ -z "$RELEASE_VERSION" ]]; then
  echo "⚠️ release: 版本号为空，跳过发布。"
  echo "【发布结论】跳过：版本号未解析。"
  exit 0
fi

# ---------- 4. 幂等去重（同版本不重复发布） ----------
if [[ "$IDEMPOTENT" == "true" ]]; then
  echo "--- 幂等去重：检查标签 ${TAG_NAME} 是否已发布 ---"
  if cnb releases get-release-by-tag --repo "$REPO_SLUG" --tag "$TAG_NAME" >/dev/null 2>&1; then
    echo "🛑 release: 版本 ${RELEASE_VERSION}（${TAG_NAME}）已存在，同版本不重复发布（幂等 R16）。"
    echo "【发布结论】跳过：版本已发布（幂等去重）。"
    exit 0
  fi
  echo "✅ 标签 ${TAG_NAME} 不存在，可发布。"
fi

# ---------- 5. 执行发布（失败重试 + 超时兜底） ----------
START_TIME=$(date +%s)

# 构建 release notes（简单占位：模块名 + 版本 + 目标分支），供 post-release 使用
RELEASE_BODY="## ${RELEASE_NAME} ${RELEASE_VERSION}

自动发布（release.sh · 意图 #17 M2 打标发布自动化）。

- 模块：${RELEASE_NAME}
- 版本：${RELEASE_VERSION}
- 分支：${DEFAULT_BRANCH}
"

# 执行单次发布（输出到日志；成功返回 0，失败/超时返回非 0）
run_single_release() {
  timeout "$STEP_TIMEOUT" cnb releases post-release \
    --repo "$REPO_SLUG" \
    --tag-name "$TAG_NAME" \
    --name "${RELEASE_NAME} ${RELEASE_VERSION}" \
    --target-commitish "$DEFAULT_BRANCH" \
    --body "$RELEASE_BODY"
}

RET=1
ATTEMPT=0
while [[ "$ATTEMPT" -lt "$MAX_RETRY" ]]; do
  ATTEMPT=$((ATTEMPT + 1))

  # 总超时检查
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  if [[ "$ELAPSED" -ge "$TOTAL_TIMEOUT" ]]; then
    echo "🛑 release: 已达总超时 ${TOTAL_TIMEOUT}s，终止发布重试。"
    echo "【发布结论】超时：${RELEASE_VERSION} 发布超时（升级链：执行体→审查→规划→管理员）。"
    exit 1
  fi

  echo "--- 发布尝试 ${ATTEMPT}/${MAX_RETRY}（标签 ${TAG_NAME}） ---"
  # 单步超时包裹（timeout 返回 124 表示超时）
  if run_single_release >/dev/null 2>&1; then
    RET=0
    break
  else
    ST_EXIT=$?
    if [[ "$ST_EXIT" -eq 124 ]]; then
      echo "⚠️ 第 ${ATTEMPT} 次发布调用超时（>${STEP_TIMEOUT}s）。"
    else
      echo "⚠️ 第 ${ATTEMPT} 次发布调用返回非 0（exit=${ST_EXIT}），重试..."
    fi
  fi
done

if [[ "$RET" -eq 0 ]]; then
  echo "✅ 发布成功：${RELEASE_NAME} ${RELEASE_VERSION}（${TAG_NAME}）。"
  echo "【发布结论】成功：${RELEASE_VERSION} 已发布（标签 ${TAG_NAME}）。"
else
  echo "⚠️ release: 发布多次尝试后仍失败（${MAX_RETRY} 次）。"
  echo "【发布结论】失败：${RELEASE_VERSION} 发布失败，需人工介入（升级链：执行体→审查→规划→管理员）。"
  exit 1
fi

# ---------- 6. 唤醒提示（串联后续流程，仅提示不擅自触发） ----------
echo "【唤醒提示】${RELEASE_NAME} ${RELEASE_VERSION} 已发布。"
echo "规划者可通过确定性通道（pull_request.merged / web_trigger）接手："
echo "  ① 需求池 R2 状态 → 已实现；② 路线图 M2 TODO 表回并；③ 合入后处理巡检。"

exit 0
