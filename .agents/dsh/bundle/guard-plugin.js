/**
 * Module: Workspace Path Jail
 * File Path: .agents/dsh/bundle/guard-plugin.js
 * Architecture Role: 治理模式族的 Host 插件本体。把工作区治理公理「SubAgent 严禁触碰授权路径之外的文件」
 *   从提示词层承诺升级为运行时执行点，由四个 Agent Preset 各自的声明行挂载。
 * Dependencies & Triggers: 依赖宿主 `tools` 注册表服务（经 preset 挂载域解析）与 `agentPresets` 注册表
 *   （按调用方 Agent 的 ctx 反查其预设身份）。挂载时注册一个单调 ToolGuard；该守卫在
 *   `tools/pre-execute` waterfall 之后、工具派发之前执行。
 * Responsibilities: 按调用方 Agent 的预设身份解析姿态策略；归一化工作区相对路径；拒绝命中禁用工具、
 *   读姿态下的写类工具、禁止根与授权面之外的目标，并以结构化原因字符串给出被拒路径与规则名。
 * Exit Semantics & Design Rationale: 拒绝只以「返回原因字符串」表达，这是 ToolGuard 契约的全部通道。
 *   姿态按调用方 Agent 的预设身份解析，而策略只在本文的 POLICY_TABLE 定义一份：四个声明行共享同一份
 *   物理实现与同一张策略表，避免四份配置各自漂移，也使判定与挂载顺序无关。声明行仍携带一个模式身份
 *   标签（`config.preset`），它只在 `agentPresets` 注册表不可用的降级路径上作为姿态来源，绝不参与正常判定。
 *   守卫对自身缺陷采取 fail-open（告警一次后放行），因为宿主沙箱仍是外层边界，且此处缺陷绝不能让会话变砖。
 *   判定次序为 deny 优先于 allow：禁止根压过授权列表，使重叠配置不会被误读为授权。
 */

export const name = 'wg-path-jail'
export const inject = ['tools']

/** 声明行携带的模式身份标签格式；仅用于注册表不可用时的姿态兜底。 */
const PRESET_ID_PATTERN = /^wg-[a-z]+$/u

const WRITE_TOOL_NAMES = Object.freeze([
  'write',
  'edit',
  'str_replace_editor',
  'notebook_edit',
])

const PATH_ARGUMENT_NAMES = Object.freeze([
  'file_path',
  'path',
  'notebook_path',
  'target_path',
])

const MODE_WRITE = 'write'
const MODE_READ = 'read'

function normalizeSlashes(value) {
  return String(value).replace(/\\/gu, '/')
}

function stripDotPrefix(value) {
  let result = value
  while (result.startsWith('./')) result = result.slice(2)
  return result
}

function trimTrailingSlash(value) {
  let result = value
  while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1)
  return result
}

function stripLeadingSlash(value) {
  let result = value
  while (result.startsWith('/')) result = result.slice(1)
  return result
}

function stripDrivePrefix(value) {
  return value.replace(/^[a-zA-Z]:/u, '')
}

function dropEmptySegments(segments) {
  return segments.filter((segment) => segment.length > 0 && segment !== '.')
}

function joinParentSegment(prefix, segment) {
  if (segment !== '..') return `${prefix}${segment}/`
  const segments = dropEmptySegments(prefix.split('/'))
  if (segments.length === 0) return ''
  return `${segments.slice(0, -1).join('/')}/`
}

function resolveDotSegments(segments) {
  let result = ''
  for (const segment of segments) result = joinParentSegment(result, segment)
  return result
}

function normalizeRelativePath(rawPath) {
  const slashed = stripDrivePrefix(stripLeadingSlash(stripDotPrefix(normalizeSlashes(rawPath))))
  return trimTrailingSlash(resolveDotSegments(slashed.split('/')))
}

const POLICY_TABLE = Object.freeze({
  'wg-construct': Object.freeze({
    mode: MODE_WRITE,
    allowRoots: Object.freeze(['workspace-timing', 'auto-refactor', 'WebGames', '.agents']),
    denyRoots: Object.freeze(['scripts', 'archive', '.git']),
    deniedTools: Object.freeze([]),
  }),
  'wg-refactor': Object.freeze({
    mode: MODE_WRITE,
    allowRoots: Object.freeze(['workspace-timing', 'auto-refactor', 'WebGames']),
    denyRoots: Object.freeze(['scripts', 'archive', '.git']),
    deniedTools: Object.freeze([]),
  }),
  'wg-review': Object.freeze({
    mode: MODE_READ,
    allowRoots: Object.freeze([]),
    denyRoots: Object.freeze([]),
    deniedTools: Object.freeze([]),
  }),
  'wg-explore': Object.freeze({
    mode: MODE_READ,
    allowRoots: Object.freeze([]),
    denyRoots: Object.freeze([]),
    deniedTools: Object.freeze([]),
  }),
})

function buildPolicy(spec) {
  return {
    mode: spec.mode,
    allowRoots: spec.allowRoots.map(normalizeRelativePath),
    denyRoots: spec.denyRoots.map(normalizeRelativePath),
    deniedTools: new Set(spec.deniedTools),
  }
}

const POLICIES = new Map(
  Object.entries(POLICY_TABLE).map(([presetId, spec]) => [presetId, buildPolicy(spec)]),
)

function isWithinRoot(target, root) {
  if (root.length === 0) return true
  return target === root || target.startsWith(`${root}/`)
}

function findFirstMatchingRoot(target, roots) {
  for (const root of roots) {
    if (isWithinRoot(target, root)) return root
  }
  return undefined
}

function extractPathArgument(args) {
  if (args === null || typeof args !== 'object') return undefined
  for (const key of PATH_ARGUMENT_NAMES) {
    if (typeof args[key] === 'string' && args[key].length > 0) return args[key]
  }
  return undefined
}

function collectPathArguments(args) {
  const single = extractPathArgument(args)
  if (single !== undefined) return [single]
  if (args === null || typeof args !== 'object' || !Array.isArray(args.paths)) return []
  return args.paths.filter((item) => typeof item === 'string' && item.length > 0)
}

function deniedToolReason(policy, toolName) {
  if (!policy.deniedTools.has(toolName)) return undefined
  return `${name}: tool "${toolName}" is disabled in the ${policy.mode} posture for this preset.`
}

function writePostureReason(policy, toolName) {
  if (!WRITE_TOOL_NAMES.includes(toolName)) return undefined
  if (policy.mode !== MODE_READ) return undefined
  return `${name}: tool "${toolName}" writes to disk, but this preset runs the read posture.`
}

function denyRootReason(policy, target) {
  const matched = findFirstMatchingRoot(target, policy.denyRoots)
  if (matched === undefined) return undefined
  return `${name}: "${target}" sits under forbidden root "${matched}" (workspace governance denial).`
}

function authorizationReason(policy, target, toolName) {
  const matched = findFirstMatchingRoot(target, policy.allowRoots)
  if (matched !== undefined) return undefined
  return `${name}: tool "${toolName}" may not touch "${target}"; authorized roots are [${
    policy.allowRoots.join(', ')
  }].`
}

function decide(policy, toolName, rawPath, caller) {
  const target = normalizeRelativePath(rawPath)
  const suffix = ` Target "${target}" stays untouched. (resolved caller: ${caller})`
  const toolReason = deniedToolReason(policy, toolName)
  if (toolReason !== undefined) return `${toolReason}${suffix}`
  const postureReason = writePostureReason(policy, toolName)
  if (postureReason !== undefined) return `${postureReason}${suffix}`
  const rootReason = denyRootReason(policy, target)
  if (rootReason !== undefined) return `${rootReason}${suffix}`
  if (policy.allowRoots.length === 0) return undefined
  const authReason = authorizationReason(policy, target, toolName)
  if (authReason === undefined) return undefined
  return `${authReason}${suffix}`
}

function checkPaths(policy, toolName, args, caller) {
  for (const rawPath of collectPathArguments(args)) {
    const reason = decide(policy, toolName, rawPath, caller)
    if (reason !== undefined) return reason
  }
  return undefined
}

function readPresetRegistry(ctx) {
  if (typeof ctx.get !== 'function') return undefined
  const registry = ctx.get('agentPresets')
  if (registry === null || registry === undefined) return undefined
  if (typeof registry.composedPreset !== 'function') return undefined
  return registry
}

/**
 * 读取声明行的模式身份标签。该标签只在 `agentPresets` 注册表不可用时充当姿态兜底，
 * 正常判定一律以调用方 Agent 的实时预设身份为准；非法或缺失一律视为未标注。
 */
function readRowPreset(config) {
  if (config === null || typeof config !== 'object') return undefined
  const candidate = config.preset
  if (typeof candidate !== 'string') return undefined
  return PRESET_ID_PATTERN.test(candidate) ? candidate : undefined
}

function resolveCaller(ctx, execution, rowPreset) {
  const fallback = rowPreset === undefined ? undefined : POLICIES.get(rowPreset)
  const agent = execution.agent
  if (agent === null || agent === undefined) return { id: 'no-agent', policy: fallback }
  if (agent.ctx === undefined) return { id: 'no-agent-ctx', policy: fallback }
  const registry = readPresetRegistry(ctx)
  if (registry === undefined) return { id: 'no-registry', policy: fallback }
  const id = registry.composedPreset(agent.ctx)
  if (id === undefined || id === null) return { id: 'unbound', policy: fallback }
  return { id: String(id), policy: POLICIES.get(id) ?? fallback }
}

function createGuard(ctx, rowPreset) {
  let warned = false
  return (execution) => {
    try {
      const { id, policy } = resolveCaller(ctx, execution, rowPreset)
      if (policy === undefined) return undefined
      return checkPaths(policy, String(execution.name), execution.arguments, id)
    } catch (error) {
      if (!warned) {
        warned = true
        ctx.logger.warn('[%s] path check failed and the call was allowed: %s', name, error)
      }
      return undefined
    }
  }
}

function warnWhenRegistryMissing(ctx, rowPreset) {
  if (readPresetRegistry(ctx) !== undefined) return
  ctx.logger.warn(
    '[%s] agentPresets registry is unavailable; postures resolve from the declaration row tag (row tag: %s)',
    name,
    rowPreset === undefined ? 'absent, every call allowed' : rowPreset,
  )
}

export function apply(ctx, config) {
  const rowPreset = readRowPreset(config)
  warnWhenRegistryMissing(ctx, rowPreset)
  ctx.effect(() => ctx.tools.guard(createGuard(ctx, rowPreset)))
  ctx.logger.info(
    '[%s] guard active: caller-resolved postures for [%s] (row tag: %s)',
    name,
    [...POLICIES.keys()].join(', '),
    rowPreset === undefined ? 'absent' : rowPreset,
  )
}
