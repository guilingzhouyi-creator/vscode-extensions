#!/usr/bin/env bash
# =============================================================================
# test-release.sh — release.sh 异常兜底用例（R2 · 意图 #17 M2 · 协作员·测试 T2-T1）
# -----------------------------------------------------------------------------
# 目的：为发布自动化 release.sh 补齐"异常兜底"最小可运行单测，覆盖三条兜底链：
#   ① 幂等去重（同版本不重复发布，R16）
#   ② 失败重试（post-release 失败自动重试 N 次）
#   ③ 超时升级链（单步超时重试 + 总超时升级执行体→审查→规划→管理员）
#
# 实现方式：不依赖真实 CNB 平台，通过注入一个**假 cnb CLI**（stub）到 PATH，
# 按场景控制 get-release-by-tag / post-release 的返回码，观察 release.sh 的
# 输出与退出码是否符合兜底预期。为最小可运行单测：无外部依赖，任意 bash 可跑。
#
# 用法：
#   bash scripts/sh/test-release.sh
#   退出码：0 = 全部用例通过；非 0 = 存在失败用例
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_SH="${SCRIPT_DIR}/release.sh"
PASS=0
FAIL=0
FAIL_NAMES=()

# ---------- 工具：临时工作目录 ----------
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# ---------- 工具：运行一条断言 ----------
assert_contains() {
  # assert_contains <haystack> <needle> <case-name>
  local haystack="$1" needle="$2" name="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    PASS=$((PASS + 1))
    echo "  ✅ ${name}"
  else
    FAIL=$((FAIL + 1))
    FAIL_NAMES+=("${name}")
    echo "  ❌ ${name}: 未匹配到「${needle}」"
  fi
}

# ---------- 假 cnb CLI（按场景脚本注入，覆盖 get-release-by-tag / post-release） ----------
# 用法：先写一个 stub 脚本到 WORKDIR/bin/cnb，再导出 PATH 前置 WORKDIR/bin。
# stub 中通过环境变量控制行为：
#   FAKE_TAG_EXISTS   : get-release-by-tag 返回 0（标签已存在→幂等跳过）
#   FAKE_POST_EXIT    : post-release 返回码（默认 0）
#   FAKE_POST_CALLS   : post-release 被调用次数（stub 自增，供断言）
#   FAKE_POST_TIMEOUT : 模拟 post-release 超时（返回 124）
mkdir -p "${WORKDIR}/bin"

# 默认 stub：tag 不存在、post 成功
cat > "${WORKDIR}/bin/cnb" <<'EOF'
#!/usr/bin/env bash
# 假 CNB CLI stub —— 仅模拟 release.sh 用到的子命令返回码
case "$1" in
  releases)
    case "$2" in
      get-release-by-tag)
        if [[ "${FAKE_TAG_EXISTS:-false}" == "true" ]]; then
          echo "mock: tag exists"
          exit 0
        else
          echo "mock: tag not found"
          exit 1
        fi
        ;;
      post-release)
        CNB_POST_CALLS=$(( ${CNB_POST_CALLS:-0} + 1 ))
        if [[ "${FAKE_POST_TIMEOUT:-false}" == "true" ]]; then
          # 模拟 timeout(1) 超时返回码 124（release.sh 用 timeout 包裹）
          exit 124
        fi
        exit "${FAKE_POST_EXIT:-0}"
        ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac
EOF
chmod +x "${WORKDIR}/bin/cnb"

# 用例运行封装：导出 PATH + 相关 env，运行 release.sh，返回其输出/退出码
run_release() {
  # run_release <output-var> <exit-var> 之后环境变量继承
  local -n __out="$1" __code="$2"
  PATH="${WORKDIR}/bin:$PATH" \
  CNB_REPO_SLUG="test-org/test-repo" \
  CNB_EVENT="${RUN_EVENT:-pull_request.merged}" \
  CNB_PULL_REQUEST_IID="${RUN_PR:-}" \
  CNB_DEFAULT_BRANCH="main" \
  MAX_RETRY="${RUN_MAX_RETRY:-3}" \
  STEP_TIMEOUT="${RUN_STEP_TIMEOUT:-120}" \
  TOTAL_TIMEOUT="${RUN_TOTAL_TIMEOUT:-600}" \
  IDEMPOTENT="${RUN_IDEMPOTENT:-true}" \
  bash "$RELEASE_SH" > "${WORKDIR}/rel_out.txt" 2>&1
  __code=$?
  __out="$(cat "${WORKDIR}/rel_out.txt")"
}

echo "=========== release.sh 异常兜底用例（T2-T1） ==========="
echo "release.sh 路径：${RELEASE_SH}"
echo ""

# ---------------------------------------------------------------------------
echo "用例组 A：幂等去重（同版本不重复发布，R16）"
# ---------------------------------------------------------------------------
echo "-- A1：标签已存在 → 跳过发布（幂等） --"
export FAKE_TAG_EXISTS=true
FAKE_POST_EXIT=0
RUN_EVENT="pull_request.merged"
run_release OUT_A1 CODE_A1
unset FAKE_TAG_EXISTS
assert_contains "$OUT_A1" "版本已发布（幂等去重）" "A1 幂等去重命中"
assert_contains "$OUT_A1" "【发布结论】跳过" "A1 发布结论为跳过"
[[ "$CODE_A1" -eq 0 ]] && { PASS=$((PASS+1)); echo "  ✅ A1 退出码为 0（幂等跳过不视为失败）"; } \
  || { FAIL=$((FAIL+1)); FAIL_NAMES+=("A1-exit"); echo "  ❌ A1 退出码应为 0，实际 ${CODE_A1}"; }

echo "-- A2：幂等关闭（IDEMPOTENT=false）→ 标签已存在也尝试发布 --"
export FAKE_TAG_EXISTS=true
FAKE_POST_EXIT=0
RUN_IDEMPOTENT=false
run_release OUT_A2 CODE_A2
unset FAKE_TAG_EXISTS RUN_IDEMPOTENT
assert_contains "$OUT_A2" "发布成功" "A2 关闭幂等后执行发布"

# ---------------------------------------------------------------------------
echo ""
echo "用例组 B：失败重试（post-release 失败自动重试 N 次）"
# ---------------------------------------------------------------------------
echo "-- B1：post 失败但未超时 → 重试至 MAX_RETRY 后升级失败 --"
export FAKE_TAG_EXISTS=false
export FAKE_POST_EXIT=1
RUN_MAX_RETRY=3
run_release OUT_B1 CODE_B1
unset FAKE_POST_EXIT RUN_MAX_RETRY
assert_contains "$OUT_B1" "发布多次尝试后仍失败" "B1 多次失败后给出失败结论"
assert_contains "$OUT_B1" "【发布结论】失败" "B1 发布结论为失败（升级链）"
[[ "$CODE_B1" -ne 0 ]] && { PASS=$((PASS+1)); echo "  ✅ B1 失败时退出码非 0（${CODE_B1}）"; } \
  || { FAIL=$((FAIL+1)); FAIL_NAMES+=("B1-exit"); echo "  ❌ B1 失败时退出码应为非 0"; }
# 断言 post 被调用了 MAX_RETRY 次（重试计数）
POST_CALLS_B1=$(grep -o "发布尝试 [0-9]" "${WORKDIR}/rel_out.txt" | tail -1 | grep -o '[0-9]')
[[ "$POST_CALLS_B1" == "3" ]] && { PASS=$((PASS+1)); echo "  ✅ B1 post 重试了 ${POST_CALLS_B1}/3 次"; } \
  || { FAIL=$((FAIL+1)); FAIL_NAMES+=("B1-retry"); echo "  ❌ B1 应重试 3 次，实际 ${POST_CALLS_B1}"; }

echo "-- B2：post 首次失败、随后成功 → 重试后发布成功 --"
# 用文件计数（每个 cnb 调用是独立进程，跨进程需文件持久化）：前 1 次失败，第 2 次成功
COUNTER_FILE="${WORKDIR}/b2_counter"
cat > "${WORKDIR}/bin/cnb" <<EOF
#!/usr/bin/env bash
case "\$1" in
  releases)
    case "\$2" in
      get-release-by-tag)
        exit 1
        ;;
      post-release)
        CNB_COUNT=\$(cat "${COUNTER_FILE}" 2>/dev/null || echo 0)
        CNB_COUNT=\$(( CNB_COUNT + 1 ))
        echo "\${CNB_COUNT}" > "${COUNTER_FILE}"
        if [[ "\${CNB_COUNT}" -ge 2 ]]; then
          exit 0
        fi
        exit 1
        ;;
    esac
    ;;
esac
EOF
chmod +x "${WORKDIR}/bin/cnb"
rm -f "${COUNTER_FILE}"
RUN_MAX_RETRY=3
run_release OUT_B2 CODE_B2
unset RUN_MAX_RETRY
assert_contains "$OUT_B2" "发布成功" "B2 重试后发布成功"
[[ "$CODE_B2" -eq 0 ]] && { PASS=$((PASS+1)); echo "  ✅ B2 退出码为 0"; } \
  || { FAIL=$((FAIL+1)); FAIL_NAMES+=("B2-exit"); echo "  ❌ B2 退出码应为 0"; }

# ---------------------------------------------------------------------------
echo ""
echo "用例组 C：超时升级链（单步超时重试 + 总超时升级）"
# ---------------------------------------------------------------------------
echo "-- C1：post 单步超时（124）→ 视为失败重试，最终超时失败升级 --"
cat > "${WORKDIR}/bin/cnb" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  releases)
    case "$2" in
      get-release-by-tag) exit 1 ;;
      post-release) exit 124 ;;  # 模拟 timeout 超时
    esac
    ;;
esac
EOF
chmod +x "${WORKDIR}/bin/cnb"
FAKE_POST_TIMEOUT=true
RUN_MAX_RETRY=2
RUN_STEP_TIMEOUT=1
RUN_TOTAL_TIMEOUT=10
run_release OUT_C1 CODE_C1
unset FAKE_POST_TIMEOUT RUN_MAX_RETRY RUN_STEP_TIMEOUT RUN_TOTAL_TIMEOUT
assert_contains "$OUT_C1" "发布调用超时" "C1 识别单步超时"
assert_contains "$OUT_C1" "发布多次尝试后仍失败" "C1 超时多次后升级失败"
assert_contains "$OUT_C1" "升级链" "C1 输出升级链提示"

echo "-- C2：总超时提前触发 → 终止重试并升级 --"
# stub：post 每次都很慢（返回 124），且 STEP_TIMEOUT=0 直接超时；TOTAL 很小触发总超时
cat > "${WORKDIR}/bin/cnb" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  releases)
    case "$2" in
      get-release-by-tag) exit 1 ;;
      post-release) exit 124 ;;
    esac
    ;;
esac
EOF
chmod +x "${WORKDIR}/bin/cnb"
RUN_STEP_TIMEOUT=0
RUN_TOTAL_TIMEOUT=0
RUN_MAX_RETRY=3
run_release OUT_C2 CODE_C2
unset RUN_STEP_TIMEOUT RUN_TOTAL_TIMEOUT RUN_MAX_RETRY
assert_contains "$OUT_C2" "已达总超时" "C2 识别总超时"
assert_contains "$OUT_C2" "发布超时" "C2 总超时发布结论"
assert_contains "$OUT_C2" "升级链" "C2 输出升级链提示"

# ---------------------------------------------------------------------------
echo ""
echo "=========== 汇总 =========="
echo "通过：${PASS}  失败：${FAIL}"
if [[ "${#FAIL_NAMES[@]}" -gt 0 ]]; then
  echo "失败用例："
  for f in "${FAIL_NAMES[@]}"; do echo "  - ${f}"; done
  exit 1
fi
echo "✅ 全部异常兜底用例通过（幂等去重 / 失败重试 / 超时升级链）。"
exit 0
