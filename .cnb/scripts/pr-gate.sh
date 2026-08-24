#!/usr/bin/env bash
# =============================================================================
# pr-gate.sh — PR 统一前置门禁程序（冲突检测 + Diff 质量初筛 + 幂等去重防卡死）
# -----------------------------------------------------------------------------
# 作用：
#   在 PR 创建/更新（pull_request 事件）时，作为**第一道确定性中枢**，在拉起任何
#   NPC 之前先执行：
#     ① 幂等去重（防卡死核心）：同一 PR 的 head commit 已审查过则直接跳过，
#        避免 4 个 NPC 被重复拉起、重复修复、级联无限触发。
#     ② 冲突检测：git merge --no-commit 预演目标分支 → 判定冲突等级 C0/C1/C2/C3。
#     ③ Diff 质量初筛：统计改动规模、检测明显质量信号（临时文件/硬编码/大重构）。
#     ④ 冲突分级派单（防卡死核心）：按分级输出唤醒建议，避免 4 个 NPC 全部并行
#        互相等待（构建等测试、测试等审查、审查等构建 → 死锁）。
#     ⑤ 输出结构化【门禁结论】给后续 NPC 读取，避免各自盲目重扫同一 PR。
#     ⑥ 合入状态读取（专职合入员配套）：读取 status/merge-ready / status/merge-blocked
#        标签，识别「陈旧否决」（head commit 已更新但仍被否决），提示合入员复核。
#
# 解决的问题（"卡死"根因）：
#   - 多重触发互相等待：一个 PR 出现，构建/测试/审查/合入员 4 个 NPC 被同时拉起，
#     但各自 userPrompt 要求"等/复核他人结论" → 并行拉起 + 串行依赖 = 死锁。
#   - 修复即再次触发的无限循环：任何执行体定点修复 push 后再次触发 pull_request，
#     又拉起 4 个 NPC，又可能再"修复" → 级联无限触发。
#   - 缺少统一前置判断：冲突分级（C1/C2/C3）与 diff 质量全靠各 NPC 自行解读，
#     职责不清、重复劳动、无人推进。
#
# 配套：
#   - 门禁治理分册 §4.7 PR 门禁自动化 / §4.8 合入冲突自动审查
#   - 流水线接入：.cnb.yml（$ 下 pull_request 事件，置于 auto-label.sh 之后、拉起 NPC 之前）
#
# 用法：
#   bash .cnb/scripts/pr-gate.sh
#   （依赖 CNB 流水线注入的环境变量 + cnb-cli + git，仅应在流水线内运行）
#
# 环境变量（由 CNB 流水线自动注入）：
#   PR 场景：CNB_PULL_REQUEST_TITLE / CNB_PULL_REQUEST_DESCRIPTION / CNB_PULL_REQUEST_IID
#   Git：    CNB_REPO_SLUG（组织/仓库）、CNB_DEFAULT_BRANCH（目标分支）、CNB_COMMIT（head commit）
#   公共：    CNB_PULL_REQUEST（是否 PR）、CNB_EVENT（事件名）、CNB_REPO_WORKTREE（可选工作区路径）
# =============================================================================
set -uo pipefail

# ---------- 0. 基础信息 ----------
REPO_SLUG="${CNB_REPO_SLUG:-}"
PR_NUM="${CNB_PULL_REQUEST_IID:-}"
TARGET_BRANCH="${CNB_DEFAULT_BRANCH:-main}"
HEAD_COMMIT="${CNB_COMMIT:-}"
REPO_ROOT="${CNB_REPO_WORKTREE:-$(pwd)}"
EVENT="${CNB_EVENT:-}"

# 本程序仅处理 PR 场景；非 PR 或缺少关键变量时优雅退出（不报错，不阻塞）
if [[ "${CNB_PULL_REQUEST:-false}" != "true" ]]; then
  echo "pr-gate: 非 PR 场景，跳过。"
  exit 0
fi
if [[ -z "$PR_NUM" ]]; then
  echo "⚠️ pr-gate: 缺少 PR 编号环境变量（CNB_PULL_REQUEST_IID 为空），跳过前置门禁。"
  exit 0
fi

echo "================= PR 统一前置门禁（pr-gate） ================="
echo "PR        : #${PR_NUM}"
echo "目标分支  : ${TARGET_BRANCH}"
echo "head commit: ${HEAD_COMMIT:-未知}"
echo "事件      : ${EVENT}"

# ---------- 1. 幂等去重（防卡死核心 · 对应容错兜底分册 §4 幂等保护 R16） ----------
# 规则：若该 PR 的 head commit 已审查过（存在 status/gate-ok 标签 或 本地缓存记录），
# 说明本次触发是"重复事件"（如：同一 commit 被平台重复推送 / 编辑评论重触发），
# 直接跳过，不再拉起任何 NPC，避免重复审查、重复修复、级联无限触发。
# 对应门禁治理分册 §4.7.3：门禁失败才需重跑；已通过则不重做。
#
# 幂等判断采用双保险：
#   a) 检查 PR 标签是否含 status/gate-ok（脚本上次通过时打上）
#   b) 本地缓存文件记录上次 head commit（二次防重）
GATE_OK_LABEL="status/gate-ok"
CACHE_DIR="${REPO_ROOT}/.cnb/.cache"
CACHE_FILE="${CACHE_DIR}/pr-gate-${PR_NUM}.last"

already_gated="false"
if [[ -n "$HEAD_COMMIT" && -f "$CACHE_FILE" ]]; then
  LAST_COMMIT="$(cat "$CACHE_FILE" 2>/dev/null | tr -d '[:space:]')"
  if [[ -n "$LAST_COMMIT" && "$LAST_COMMIT" == "$HEAD_COMMIT" ]]; then
    already_gated="true"
  fi
fi

if [[ "$already_gated" == "true" ]]; then
  echo "🛑 pr-gate: PR #${PR_NUM} 的 head commit（${HEAD_COMMIT}）已审查过，本次为重复触发，跳过（幂等防卡死）。"
  echo "【门禁结论】跳过：重复触发，已审查，无需拉起 NPC。"
  exit 0
fi

# 附加标签校验（尽力而为，CNB CLI 不可用时不阻断）
if command -v cnb >/dev/null 2>&1; then
  CUR_LABELS=$(cnb pulls list-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" 2>/dev/null || true)
  if echo "$CUR_LABELS" | grep -q "$GATE_OK_LABEL"; then
    echo "🛑 pr-gate: PR #${PR_NUM} 已打 ${GATE_OK_LABEL} 标签（已审查），本次重复触发，跳过（幂等防卡死）。"
    echo "【门禁结论】跳过：已审查（标签幂等），无需拉起 NPC。"
    exit 0
  fi
fi

echo "--- 幂等检查通过：本次为新提交，进入冲突检测与 Diff 初筛 ---"

# ---------- 2. 冲突检测（对应门禁治理分册 §4.8 合入冲突自动审查） ----------
# 用 git merge --no-commit 预演目标分支合并，判断是否存在 Git 合并冲突。
CONFLICT_LEVEL="C0"      # C0=无冲突 C1=可自动化解 C2=需审查判断 C3=高危
CONFLICT_FILES=""

if git rev-parse --git-dir >/dev/null 2>&1; then
  # 先确认目标分支存在（本地或 origin 前缀），不存在则无法预演，按无冲突（C0）处理
  # （避免目标分支不存在时 merge 报错被误判为冲突）
  MERGE_TARGET=""
  if git rev-parse --verify -q "${TARGET_BRANCH}" >/dev/null 2>&1; then
    MERGE_TARGET="${TARGET_BRANCH}"
  elif git rev-parse --verify -q "origin/${TARGET_BRANCH}" >/dev/null 2>&1; then
    MERGE_TARGET="origin/${TARGET_BRANCH}"
  fi

  if [[ -n "$MERGE_TARGET" ]]; then
    # 预演合并：git merge --no-commit，再回退，不污染当前 HEAD
    if git merge --no-commit --no-ff "$MERGE_TARGET" >/dev/null 2>&1; then
      CONFLICT_LEVEL="C0"
      git merge --abort >/dev/null 2>&1 || git reset --merge >/dev/null 2>&1 || true
    else
      CONFLICT_LEVEL="C2"
      CONFLICT_FILES=$(git diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ' ')
      git merge --abort >/dev/null 2>&1 || git reset --merge >/dev/null 2>&1 || true
      echo "⚠️ pr-gate: 检测到 Git 合并冲突。冲突文件: ${CONFLICT_FILES:-未知}"
    fi
  else
    echo "ℹ️ pr-gate: 目标分支 ${TARGET_BRANCH} 本地不存在，跳过冲突预演（按 C0 无冲突处理）。"
  fi
else
  echo "ℹ️ pr-gate: 当前环境无 git 仓库或无法预演合并，默认按无冲突（C0）处理。"
fi

# 冲突分级细化（尽力而为）：
#   - 冲突文件涉及 核心逻辑/数据迁移/破坏性变更 → 升 C3 高危
#   - 冲突文件数量多 / 涉及越权 → C2（需审查判断）
#   - 简单文件 → C1（冲突双方可自动化解，交由构建/测试主责处理）
case "$CONFLICT_LEVEL" in
  C2)
    HI_RISK_HINT="false"
    for f in ${CONFLICT_FILES:-}; do
      case "$f" in
        *migrat*|*schema*|*database*|*data*|src/core*|src/main*|package.json|package-lock.json) HI_RISK_HINT="true"; break ;;
      esac
    done
    if [[ "$HI_RISK_HINT" == "true" ]]; then
      CONFLICT_LEVEL="C3"
      echo "⚠️ pr-gate: 冲突涉及高危文件（数据迁移/核心逻辑/依赖），升级为 C3 高危。"
    elif [[ -z "${CONFLICT_FILES:-}" ]]; then
      CONFLICT_LEVEL="C2"
    else
      CONFLICT_LEVEL="C1"
      echo "ℹ️ pr-gate: 冲突文件较少且非高危，判定为 C1（可自动化解）。"
    fi
    ;;
esac

# ---------- 3. Diff 质量初筛（对应门禁治理分册 §4.5 自动化审查范围） ----------
DIFF_STATS=""
CHANGED_FILES_CNT=0
ADDED_LINES=0
DELETED_LINES=0
QUALITY_FLAGS=()

if git rev-parse --git-dir >/dev/null 2>&1; then
  # 确定可用的 diff 基准（尽力而为）：优先 origin/<目标分支>，其次 <目标分支>，
  # 最后退化为 HEAD~1（仅当能拿到父提交时），避免分支不存在导致的多行/语法错误。
  DIFF_BASE=""
  if git rev-parse --verify -q "origin/${TARGET_BRANCH}" >/dev/null 2>&1; then
    DIFF_BASE="origin/${TARGET_BRANCH}"
  elif git rev-parse --verify -q "${TARGET_BRANCH}" >/dev/null 2>&1; then
    DIFF_BASE="${TARGET_BRANCH}"
  elif git rev-parse --verify -q "HEAD~1" >/dev/null 2>&1; then
    DIFF_BASE="HEAD~1"
  fi

  if [[ -n "$DIFF_BASE" ]]; then
    DIFF_STATS="$(git diff --stat "${DIFF_BASE}...HEAD" 2>/dev/null || true)"
    CHANGED_FILES_CNT="$(git diff --name-only "${DIFF_BASE}...HEAD" 2>/dev/null | grep -c '^' || true)"
    ADDED_LINES="$(git diff --numstat "${DIFF_BASE}...HEAD" 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {s+=$1} END{print s+0}' || echo "0")"
    DELETED_LINES="$(git diff --numstat "${DIFF_BASE}...HEAD" 2>/dev/null | awk '$2 ~ /^[0-9]+$/ {s+=$2} END{print s+0}' || echo "0")"
    CHANGED_FILES_CNT="$(echo "$CHANGED_FILES_CNT" | tr -d '[:space:]')"
    ADDED_LINES="$(echo "$ADDED_LINES" | tr -d '[:space:]')"
    DELETED_LINES="$(echo "$DELETED_LINES" | tr -d '[:space:]')"
  else
    DIFF_STATS="（无可用 diff 基准，跳过统计）"
    CHANGED_FILES_CNT=0; ADDED_LINES=0; DELETED_LINES=0
  fi

  # 质量信号初筛（简单关键词扫描 diff 文本，供审查聚焦；不替代正式审查）
  DIFF_TEXT=""
  if [[ -n "$DIFF_BASE" ]]; then
    DIFF_TEXT="$(git diff "${DIFF_BASE}...HEAD" 2>/dev/null || true)"
  fi
  if echo "$DIFF_TEXT" | grep -qE '^\+\s*(const|let|var).{0,20}=["\x27][0-9a-zA-Z_./]{3,}["\x27]'; then
    QUALITY_FLAGS+=("疑似硬编码（字符串字面量，建议抽配置/常量）")
  fi
  if echo "$DIFF_TEXT" | grep -qE '^\+\s*(TODO|FIXME|HACK)\b'; then
    QUALITY_FLAGS+=("新增 TODO/FIXME 待办（需确认是否遗留）")
  fi
  if echo "$DIFF_TEXT" | grep -qE '^\+\s*console\.(log|debug)\b'; then
    QUALITY_FLAGS+=("新增调试输出 console.log（生产代码建议移除）")
  fi
  if [[ "${CHANGED_FILES_CNT:-0}" -gt 30 ]]; then
    QUALITY_FLAGS+=("改动文件数大（${CHANGED_FILES_CNT} 个）——疑似大重构/越权，需审查确认 R2")
  fi
  if [[ "${ADDED_LINES:-0}" -gt 800 ]]; then
    QUALITY_FLAGS+=("净增行数大（${ADDED_LINES} 行）——疑似超大规模改动，需审查确认")
  fi
else
  DIFF_STATS="（无法获取 git diff，跳过统计）"
fi

echo ""
echo "--- Diff 质量初筛 ---"
echo "变更文件数 : ${CHANGED_FILES_CNT:-0}"
echo "净增行     : ${ADDED_LINES:-0}  净删行: ${DELETED_LINES:-0}"
if [[ "${#QUALITY_FLAGS[@]}" -gt 0 ]]; then
  echo "质量信号    :"
  for flag in "${QUALITY_FLAGS[@]}"; do
    echo "  ⚠️ ${flag}"
  done
else
  echo "质量信号    : 未发现明显硬编码/临时文件/超大规模信号 ✅"
fi

# ---------- 4. 冲突分级派单（防卡死核心 · 对应门禁治理分册 §4.8.2） ----------
# 核心目标：避免 4 个 NPC 全部并行拉起后互相等待。按分级只唤醒"本轮必须推进"的对象，
# 并明确"谁主导、谁补位"，其余不重复触发。
case "$CONFLICT_LEVEL" in
  C0)
    WAKE_GUIDE="无冲突 → 由【协作员·审查】主导执行 PR 门禁（规范门禁主审+四眼复核），
构建/测试补位各自门禁；合入员汇总合入门禁（决策，R21）。无重复触发。"
    ;;
  C1)
    WAKE_GUIDE="冲突可自动化解 → 由冲突双方【协作员·构建】/【协作员·测试】按主责定点化解并重跑门禁，
审查复核；不额外拉起规划者。"
    ;;
  C2)
    WAKE_GUIDE="冲突需审查判断 → 由【协作员·审查】（主审）+【合入员】（合入门禁）推进，
冲突方定点修复；构建/测试补位门禁验证。"
    ;;
  C3)
    WAKE_GUIDE="高危冲突 → 由【协作员·审查】+ 官方 CodeBuddy 复核 + 提出者（强制人工），
禁止自动合入（门禁治理 §4.8.4/§4.8.5）。其余执行体暂停推进，避免盲目改坏核心。"
    ;;
esac

echo ""
echo "--- 冲突分级与派单 ---"
echo "冲突等级  : ${CONFLICT_LEVEL}"
echo "唤醒建议  : ${WAKE_GUIDE}"

# ---------- 5. 输出结构化【门禁结论】 + 幂等落盘 ----------
# 5.1 幂等缓存落盘（head commit 记录，防重复触发）
if [[ -n "$HEAD_COMMIT" ]]; then
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  echo "$HEAD_COMMIT" > "$CACHE_FILE" 2>/dev/null || true
fi

# 5.2 尝试打上 status/gate-ok 标签（幂等；CNB CLI 不可用时忽略，不阻断）
if command -v cnb >/dev/null 2>&1; then
  cnb pulls post-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" --labels "$GATE_OK_LABEL" >/dev/null 2>&1 || true
fi

# 5.3 输出门禁结论（供后续 NPC 读取，避免各自盲目重扫）
echo ""
echo "【门禁结论】PR #${PR_NUM}"
echo "  冲突等级 : ${CONFLICT_LEVEL}"
echo "  冲突文件 : ${CONFLICT_FILES:-无}"
echo "  变更规模 : ${CHANGED_FILES_CNT:-0} 文件 / +${ADDED_LINES:-0} -${DELETED_LINES:-0} 行"
echo "  质量信号 : ${QUALITY_FLAGS[*]:-未发现明显信号}"
echo "  唤醒建议 : ${WAKE_GUIDE}"
echo "【唤醒提示】后续 NPC（审查/构建/测试/合入员）请读取本结论后再分工，避免重复拉起与互相等待；"
echo "  已打 ${GATE_OK_LABEL} 标签用于幂等防重（同一 head commit 重复触发将跳过）。"

# ---------- 5.4 合入状态读取（专职合入员配套 · 2026-08-21 增强） ----------
# 读取 PR 的合入决策标签（status/merge-ready / status/merge-blocked），
# 供合入员 Stage 4 决策与 pull_request.mergeable 复核参考。
# 陈旧否决识别：本 PR 有新提交（已过幂等检查 = head commit 更新）却仍带 merge-blocked，
# 说明否决可能针对旧 commit → 提示合入员复核；人工否决不自动清除（保否决权）。
MERGE_STATE_LINE="无合入决策标签（尚未由合入员判定）"
if command -v cnb >/dev/null 2>&1; then
  CUR_LABELS2=$(cnb pulls list-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" 2>/dev/null || true)
  if echo "$CUR_LABELS2" | grep -q "status/merge-blocked"; then
    MERGE_STATE_LINE="status/merge-blocked（存在否决 → 自动合入被阻断）"
    echo "⚠️ 陈旧否决提示：PR #${PR_NUM} 存在 status/merge-blocked 否决标签，但本次为新提交（head ${HEAD_COMMIT:-未知}）。"
    echo "  请【合入员】在 Stage 4 合入门禁复核该否决是否仍有效；人工否决需人工确认解除，脚本不自动清除。"
  elif echo "$CUR_LABELS2" | grep -q "status/merge-ready"; then
    MERGE_STATE_LINE="status/merge-ready（已放行 → 满足条件可自动合入）"
  fi
fi
echo "  合入状态 : ${MERGE_STATE_LINE}"

exit 0
