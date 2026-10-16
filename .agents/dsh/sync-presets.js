/**
 * Module: DSH Agent Preset Bundle Isomorphic Sync
 * File Path: .agents/dsh/sync-presets.js
 * Architecture Role: 单源真源与运行时安装面之间的唯一同步信道（构建期工具，非运行时依赖）。
 * Dependencies & Triggers: node:fs / node:path / node:os / node:url；手工触发或门禁脚本调用。
 * Responsibilities: 把 .agents/dsh/bundle/ 下的治理 bundle 单源（package.json、
 *   cordis.patch.yml、host-plugin.js 三件）逐字节镜像到
 *   $DSH_PROFILE_DIR/.dsh-plugin-download/<包名>/（plugin_manager install_bundle 的安装源），
 *   并提供 --check-only 同构校验（单源与安装源字节等价）。
 * Exit Semantics & Design Rationale: 校验模式发现任何差异即以退出码 1 结束并逐条打印漂移坐标，
 *   零差异以退出码 0 结束；部署模式只写入字节不等的文件，不删除安装目录中的外来文件。
 *   安装源根经 DSH_PROFILE_DIR / DSH_HOME 环境变量解析，回退到 os.homedir()，不硬编码盘符。
 *   历史沿革：DSH 旧版按目录读取 $DSH_HOME/.agent-presets/<id>/，该格式已不再被读取；
 *   现行唯一有效路径是 bundle 补丁声明行，故本脚本的目标根随之改为安装源目录。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)))
const SOURCE_ROOT = join(SCRIPT_DIR, 'bundle')
const PACKAGE_FILE = 'package.json'

/** 保留相对路径结构的逐文件遍历，返回按路径排序的 [相对路径, 绝对路径] 列表。 */
function collectBundleFiles(root, prefix = '') {
  const found = []
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name
    const absolute = join(root, rel)
    if (statSync(absolute).isDirectory()) {
      found.push(...collectBundleFiles(root, rel))
      continue
    }
    found.push([rel, absolute])
  }
  return found.sort((left, right) => left[0].localeCompare(right[0]))
}

function readBundleIdentity() {
  const manifestPath = join(SOURCE_ROOT, PACKAGE_FILE)
  if (!existsSync(manifestPath)) {
    throw new Error(`bundle manifest is missing: ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error(`${PACKAGE_FILE} declares no package name`)
  }
  return manifest.name
}

/** 以运行期环境解析安装源根，避免在受版本控制的文件中书写绝对路径。 */
function resolveDeployRoot(packageName) {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.length > 0) {
    return join(resolve(profileDir), '.dsh-plugin-download', packageName)
  }
  const home = process.env.DSH_HOME ?? process.env.USERPROFILE ?? homedir()
  return join(resolve(home), '.dsh-plugin-download', packageName)
}

function classify(sourcePath, targetPath) {
  if (!existsSync(targetPath)) return 'missing'
  return readFileSync(sourcePath).equals(readFileSync(targetPath)) ? 'identical' : 'drifted'
}

function deployFile(sourcePath, targetPath) {
  const state = classify(sourcePath, targetPath)
  if (state === 'identical') return state
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(sourcePath, targetPath)
  return state === 'missing' ? 'created' : 'updated'
}

function run(checkOnly) {
  if (!existsSync(SOURCE_ROOT)) {
    throw new Error(`bundle source is missing: ${SOURCE_ROOT}`)
  }
  const packageName = readBundleIdentity()
  const deployRoot = resolveDeployRoot(packageName)
  const files = collectBundleFiles(SOURCE_ROOT)
  const drifts = []
  const actions = []
  for (const [rel, sourcePath] of files) {
    const targetPath = join(deployRoot, rel)
    if (checkOnly) {
      const state = classify(sourcePath, targetPath)
      if (state !== 'identical') drifts.push(`${rel}: ${state}`)
      continue
    }
    actions.push(`${rel}: ${deployFile(sourcePath, targetPath)}`)
  }
  const scope = relative(SCRIPT_DIR, deployRoot)
  if (checkOnly) {
    if (drifts.length > 0) {
      process.stderr.write(`isomorphic check failed against ${scope}\n${drifts.map((line) => `  ${line}`).join('\n')}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`isomorphic check passed: ${files.length} bundle file(s) byte-equal to ${scope}\n`)
    return
  }
  const changed = actions.filter((line) => !line.endsWith('identical'))
  process.stdout.write(`synced bundle ${packageName} to ${scope}: ${changed.length} file(s) written\n`)
  process.stdout.write(`install source: ${resolve(deployRoot)}\n`)
  for (const line of changed) process.stdout.write(`  ${line}\n`)
}

function main(argv) {
  const checkOnly = argv.includes('--check-only')
  const unknown = argv.filter((flag) => !['--check-only', '--deploy'].includes(flag))
  if (unknown.length > 0) {
    process.stderr.write(`unknown argument(s): ${unknown.join(' ')}\nusage: node ${basename(fileURLToPath(import.meta.url))} [--check-only | --deploy]\n`)
    process.exitCode = 1
    return
  }
  run(checkOnly)
}

main(process.argv.slice(2))
