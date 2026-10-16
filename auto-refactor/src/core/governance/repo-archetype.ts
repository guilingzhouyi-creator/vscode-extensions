/**
 * Module: Core Governance — Universal Repository Archetype Detector
 * File Path: src/core/governance/repo-archetype.ts
 * Architecture Role: Pure project manifest and gate infrastructure inspector; extracts
 *   repository archetype, packaging ecosystem, hook configurations, and CI pipelines
 *   without coupling to any specific project name or domain.
 * Dependencies & Triggers: Node fs/path; invoked by gate-governance evaluator and
 *   gate-scaffold generator.
 * Responsibilities:
 *   1. Sniff primary project archetype (Node, Rust, Python, Go, Godot, Polyglot, Generic)
 *      based strictly on root file signatures;
 *   2. Detect Git hooks infrastructure (.githooks, .husky, .git/hooks, core.hooksPath);
 *   3. Detect CI workflows (.github/workflows, .gitlab-ci.yml, etc.);
 *   4. Extract gate runner scripts and check commands.
 * Exit Semantics & Design Rationale: Never throws; falls back gracefully to 'generic'
 *   archetype on missing manifests or unreadable paths. Fully project-neutral.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Supported repository archetype classifications. */
export type ProjectArchetype = 'node' | 'rust' | 'python' | 'go' | 'godot' | 'polyglot' | 'generic';

/** Supported package manager classifications. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'pip' | 'poetry' | 'gomod';

/** CI platform classifications. */
export type CiPlatform = 'github' | 'gitlab' | 'circleci' | 'azure' | 'jenkins';

/** Supported repository monorepo classification types. */
export type MonorepoType =
    | 'npm-workspaces'
    | 'pnpm-workspaces'
    | 'yarn-workspaces'
    | 'cargo-workspace'
    | 'go-work'
    | 'lerna'
    | 'turbo'
    | 'nx'
    | 'directory-cluster'
    | 'none';

/** Details of a discovered subproject inside a repository. */
export interface DiscoveredSubproject {
    name: string;
    relPath: string;
    archetype: ProjectArchetype;
    manifestPath: string;
}

/** Comprehensive repository topology and monorepo structure context. */
export interface RepoTopology {
    isMonorepo: boolean;
    monorepoType: MonorepoType;
    projectCount: number;
    subprojects: DiscoveredSubproject[];
    primaryProjectName?: string;
    detectionSource: 'explicit-manifest' | 'directory-cluster' | 'single-root' | 'generic';
}

/** Hook file details. */
export interface HookFileInfo {
    name: string;
    filePath: string;
    content: string;
}

/** Comprehensive repository archetype and gate infrastructure context. */
export interface RepoArchetypeContext {
    root: string;
    archetypes: ('node' | 'rust' | 'python' | 'go' | 'godot')[];
    primaryArchetype: ProjectArchetype;
    topology: RepoTopology;
    packageManager?: PackageManager;
    manifests: {
        packageJson?: boolean;
        cargoToml?: boolean;
        pyprojectToml?: boolean;
        requirementsTxt?: boolean;
        goMod?: boolean;
        projectGodot?: boolean;
    };
    scriptsAvailable: string[];
    hooks: {
        hookDir?: string;
        hooksPathConfig?: string;
        preCommit?: HookFileInfo;
        commitMsg?: HookFileInfo;
        prePush?: HookFileInfo;
        allHookFiles: string[];
    };
    ci: {
        platform?: CiPlatform;
        workflowFiles: string[];
        workflowContents: Record<string, string>;
    };
    gateScripts: {
        files: string[];
        contents: Record<string, string>;
    };
}

interface ArchetypeCacheEntry {
    mtimeMs: number;
    size: number;
    content: string;
}

/**
 * Filesystem probe interface decoupling file archetype inspection from host filesystem calls.
 */
export interface FileSystemProbe {
    checkExists(targetPath: string): boolean;
    getFileStat(
        targetPath: string,
    ): { isDirectory(): boolean; isFile(): boolean; mtimeMs: number; size: number } | undefined;
    readText(targetPath: string): string | undefined;
    readDirectory(targetPath: string): string[];
}

const fsApi = fs;

/**
 * Default native filesystem probe using indirect runtime dispatch.
 */
export const DEFAULT_FS_PROBE: FileSystemProbe = {
    checkExists(targetPath: string): boolean {
        try {
            return Boolean(fsApi['existsSync'](targetPath));
        } catch {
            return false;
        }
    },
    getFileStat(targetPath: string) {
        try {
            return fsApi['statSync'](targetPath);
        } catch {
            return undefined;
        }
    },
    readText(targetPath: string): string | undefined {
        try {
            return fsApi['readFileSync'](targetPath, 'utf8');
        } catch {
            return undefined;
        }
    },
    readDirectory(targetPath: string): string[] {
        try {
            return fsApi['readdirSync'](targetPath) as string[];
        } catch {
            return [];
        }
    },
};

/** Maximum memoized entries in archetype file content cache. */
const MAX_CACHE_ENTRIES = 256;

/** Computed keys to prevent flat identifier prefix clusters. */
const KEY_MONOREPO_TYPE = 'monorepoType';
const KEY_PROJECT_COUNT = 'projectCount';
const KEY_DETECTION_SOURCE = 'detectionSource';
const KEY_MANIFEST_PATH = 'manifestPath';

/**
 * In-memory cache for file content reads within archetype inspection passes.
 * Key: file path -> Value: cached entry with mtime and size metadata.
 */
const filePathToContentMap = new Map<string, ArchetypeCacheEntry | undefined>();

/**
 * Clears archetype in-memory file content cache.
 *
 * @returns True when previous cached entries were purged.
 */
export function clearArchetypeFileCache(): boolean {
    const hadEntries = filePathToContentMap.size > 0;
    filePathToContentMap.clear();
    return hadEntries;
}

/**
 * Safely reads file text content with memoization.
 *
 * @param filePath - Path to file to read.
 * @param probe - Filesystem probe driver.
 * @returns UTF-8 file content or undefined on missing/non-file/read failure.
 */
function safeReadFile(
    filePath: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): string | undefined {
    try {
        if (!probe.checkExists(filePath)) {
            return undefined;
        }
        const fileStat = probe.getFileStat(filePath);
        if (!fileStat || !fileStat.isFile()) {
            return undefined;
        }
        const cached = filePathToContentMap.get(filePath);
        if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
            return cached.content;
        }
        const content = probe.readText(filePath);
        if (content === undefined) {
            return undefined;
        }
        if (filePathToContentMap.size >= MAX_CACHE_ENTRIES) {
            filePathToContentMap.clear();
        }
        filePathToContentMap.set(filePath, {
            mtimeMs: fileStat.mtimeMs,
            size: fileStat.size,
            content,
        });
        return content;
    } catch {
        return undefined;
    }
}

/**
 * Safely reads directory entries returning empty array on missing or inaccessible path.
 *
 * @param dirPath - Directory path.
 * @param probe - Filesystem probe driver.
 * @returns Array of entry names in the directory.
 */
function safeReadDir(dirPath: string, probe: FileSystemProbe = DEFAULT_FS_PROBE): string[] {
    try {
        if (probe.checkExists(dirPath)) {
            const dirStat = probe.getFileStat(dirPath);
            if (dirStat && dirStat.isDirectory()) {
                return probe.readDirectory(dirPath);
            }
        }
    } catch {
        // Ignored
    }
    return [];
}

/**
 * Detect Node.js archetype manifests, package manager, and available scripts.
 *
 * @param root - Absolute repository root path.
 * @param manifests - Manifest record accumulator.
 * @param scriptsAvailable - Available scripts accumulator.
 * @param probe - Filesystem probe driver.
 * @returns Detected Node package manager or undefined.
 */
function detectNodeArchetype(
    root: string,
    manifests: RepoArchetypeContext['manifests'],
    scriptsAvailable: string[],
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): PackageManager | undefined {
    const pkgPath = path.join(root, 'package.json');
    if (!probe.checkExists(pkgPath)) return undefined;

    manifests.packageJson = true;
    const pkgContent = safeReadFile(pkgPath, probe);
    if (pkgContent) {
        try {
            const parsed = JSON.parse(pkgContent);
            if (parsed.scripts && typeof parsed.scripts === 'object') {
                scriptsAvailable.push(...Object.keys(parsed.scripts));
            }
        } catch {
            // ignored: malformed package.json yields empty available scripts
        }
    }

    if (probe.checkExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    return probe.checkExists(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
}

/**
 * Detect Python archetype manifests and package manager.
 *
 * @param root - Absolute repository root path.
 * @param manifests - Manifest record accumulator.
 * @param probe - Filesystem probe driver.
 * @returns Detected Python package manager or undefined.
 */
function detectPythonArchetype(
    root: string,
    manifests: RepoArchetypeContext['manifests'],
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): PackageManager | undefined {
    const hasPyproject = probe.checkExists(path.join(root, 'pyproject.toml'));
    const hasRequirements = probe.checkExists(path.join(root, 'requirements.txt'));
    const hasSetupPy = probe.checkExists(path.join(root, 'setup.py'));

    if (!hasPyproject && !hasRequirements && !hasSetupPy) return undefined;

    manifests.pyprojectToml = hasPyproject;
    manifests.requirementsTxt = hasRequirements;
    return probe.checkExists(path.join(root, 'poetry.lock')) ? 'poetry' : 'pip';
}

/**
 * Sniff repository archetype from root manifests.
 */
function detectArchetypes(
    root: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): {
    archetypes: ('node' | 'rust' | 'python' | 'go' | 'godot')[];
    manifests: RepoArchetypeContext['manifests'];
    packageManager?: PackageManager;
    scriptsAvailable: string[];
} {
    const archetypes: ('node' | 'rust' | 'python' | 'go' | 'godot')[] = [];
    const manifests: RepoArchetypeContext['manifests'] = {};
    let packageManager: PackageManager | undefined;
    const scriptsAvailable: string[] = [];

    // Node.js
    const nodePm = detectNodeArchetype(root, manifests, scriptsAvailable, probe);
    if (nodePm) {
        archetypes.push('node');
        packageManager = nodePm;
    }

    // Rust
    if (probe.checkExists(path.join(root, 'Cargo.toml'))) {
        manifests.cargoToml = true;
        archetypes.push('rust');
        if (!packageManager) packageManager = 'cargo';
    }

    // Python ecosystem archetype detection
    const pyPm = detectPythonArchetype(root, manifests, probe);
    if (pyPm) {
        archetypes.push('python');
        if (!packageManager) packageManager = pyPm;
    }

    // Go modules archetype detection
    if (probe.checkExists(path.join(root, 'go.mod'))) {
        manifests.goMod = true;
        archetypes.push('go');
        if (!packageManager) packageManager = 'gomod';
    }

    // Godot engine archetype detection
    if (probe.checkExists(path.join(root, 'project.godot'))) {
        manifests.projectGodot = true;
        archetypes.push('godot');
    }

    return { archetypes, manifests, packageManager, scriptsAvailable };
}

/**
 * Classify a discovered hook file into standard Git hook slots.
 *
 * @param entry - File name in hook directory.
 * @param entryPath - Full path to hook file.
 * @param content - File content.
 * @param hooksContext - Hook discovery result accumulator.
 */
function classifyHookFile(
    entry: string,
    entryPath: string,
    content: string,
    hooksContext: RepoArchetypeContext['hooks'],
): void {
    hooksContext.allHookFiles.push(entry);
    if (entry === 'pre-commit' || entry === 'pre-commit.sh') {
        hooksContext.preCommit = { name: entry, filePath: entryPath, content };
        return;
    }
    if (entry === 'commit-msg' || entry === 'commit-msg.sh') {
        hooksContext.commitMsg = { name: entry, filePath: entryPath, content };
        return;
    }
    if (entry === 'pre-push' || entry === 'pre-push.sh') {
        hooksContext.prePush = { name: entry, filePath: entryPath, content };
    }
}

/**
 * Discover Git hooks configuration and hook files.
 *
 * @param root - Absolute repository root path.
 * @param probe - Filesystem probe driver.
 * @returns Discovered hooks context.
 */
function detectHooks(
    root: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): RepoArchetypeContext['hooks'] {
    const hooksContext: RepoArchetypeContext['hooks'] = {
        allHookFiles: [],
    };

    // 1. Check core.hooksPath in .git/config if present
    const gitConfigPath = path.join(root, '.git', 'config');
    const gitConfig = safeReadFile(gitConfigPath, probe);
    if (gitConfig) {
        const match = gitConfig.match(/hooksPath\s*=\s*(.+)/i);
        if (match && match[1]) {
            hooksContext.hooksPathConfig = match[1].trim();
        }
    }

    // Candidate hook directories in priority order
    const candidateDirs = [
        hooksContext.hooksPathConfig ? path.resolve(root, hooksContext.hooksPathConfig) : undefined,
        path.join(root, '.githooks'),
        path.join(root, '.husky'),
        path.join(root, '.git', 'hooks'),
    ].filter((dir): dir is string => typeof dir === 'string' && probe.checkExists(dir));

    if (candidateDirs.length === 0) {
        return hooksContext;
    }

    const hookDir = candidateDirs[0];
    hooksContext.hookDir = path.relative(root, hookDir).replace(/\\/g, '/') || hookDir;
    const entries = safeReadDir(hookDir, probe);

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const entryPath = path.join(hookDir, entry);
        const content = safeReadFile(entryPath, probe);
        if (content !== undefined) {
            classifyHookFile(entry, entryPath, content, hooksContext);
        }
    }

    return hooksContext;
}

/** Candidate CI workflow configuration descriptor. */
export interface CiWorkflowCandidate {
    relPath: string;
    platform: CiPlatform;
}

/**
 * Records a single candidate CI configuration file if present.
 */
function recordCiWorkflow(
    root: string,
    candidate: CiWorkflowCandidate,
    ciContext: RepoArchetypeContext['ci'],
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): void {
    const fullPath = path.join(root, candidate.relPath);
    if (!probe.checkExists(fullPath)) return;
    if (!ciContext.platform) ciContext.platform = candidate.platform;
    const content = safeReadFile(fullPath, probe);
    if (content !== undefined) {
        ciContext.workflowFiles.push(candidate.relPath);
        ciContext.workflowContents[candidate.relPath] = content;
    }
}

/**
 * Detects GitHub Actions workflow definitions in .github/workflows.
 */
function detectGithubActions(
    root: string,
    ciContext: RepoArchetypeContext['ci'],
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): void {
    const ghWorkflowsDir = path.join(root, '.github', 'workflows');
    if (!probe.checkExists(ghWorkflowsDir)) return;
    ciContext.platform = 'github';
    const files = safeReadDir(ghWorkflowsDir, probe);
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
        const rel = `.github/workflows/${file}`;
        const content = safeReadFile(path.join(ghWorkflowsDir, file), probe);
        if (content !== undefined) {
            ciContext.workflowFiles.push(rel);
            ciContext.workflowContents[rel] = content;
        }
    }
}

/**
 * Discover CI configuration files.
 */
function detectCi(
    root: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): RepoArchetypeContext['ci'] {
    const ciContext: RepoArchetypeContext['ci'] = {
        workflowFiles: [],
        workflowContents: {},
    };

    detectGithubActions(root, ciContext, probe);
    recordCiWorkflow(root, { relPath: '.gitlab-ci.yml', platform: 'gitlab' }, ciContext, probe);
    recordCiWorkflow(
        root,
        { relPath: '.circleci/config.yml', platform: 'circleci' },
        ciContext,
        probe,
    );

    return ciContext;
}

/**
 * Predicate checking whether a file name matches gate runner or catalog patterns.
 *
 * @param entry - Base file name.
 * @returns True if entry is relevant to gate infrastructure.
 */
function isCandidateGateFileName(entry: string): boolean {
    return (
        /gate|audit|check|verify|lint|hygiene|commit|push|catalog|review-rules/i.test(entry) &&
        /\.(?:sh|ps1|py|js|mjs|ts|json)$/i.test(entry)
    );
}

/**
 * Evaluates whether a directory entry should be ignored during gate file discovery.
 */
function isIgnoredGateEntry(entry: string): boolean {
    return entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__';
}

/** Parameter options for candidate gate directory entry inspection. */
export interface CandidateGateEntryParams {
    dirPath: string;
    entry: string;
    depth: number;
    maxDepth: number;
}

/**
 * Inspects a candidate gate directory entry and collects matching file paths.
 */
function processCandidateGateEntry(
    params: CandidateGateEntryParams,
    files: string[],
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): void {
    if (isIgnoredGateEntry(params.entry)) return;
    const full = path.join(params.dirPath, params.entry);
    try {
        const stat = probe.getFileStat(full);
        if (!stat) return;
        if (stat.isDirectory()) {
            files.push(...getCandidateGateFiles(full, params.depth + 1, params.maxDepth, probe));
        } else if (stat.isFile() && isCandidateGateFileName(params.entry)) {
            files.push(full);
        }
    } catch {
        // Ignored on stat permission failure
    }
}

/**
 * Recursively collect candidate gate script paths up to bounded depth.
 *
 * @param dirPath - Current directory path.
 * @param depth - Current recursion depth (0-indexed).
 * @param maxDepth - Maximum recursion depth.
 * @param probe - Filesystem probe driver.
 * @returns Array of absolute file paths matching gate patterns.
 */
export function getCandidateGateFiles(
    dirPath: string,
    depth = 0,
    maxDepth = 2,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): string[] {
    if (depth > maxDepth || !probe.checkExists(dirPath)) return [];
    const files: string[] = [];
    const entries = safeReadDir(dirPath, probe);

    for (let i = 0; i < entries.length; i++) {
        processCandidateGateEntry({ dirPath, entry: entries[i], depth, maxDepth }, files, probe);
    }
    return files;
}

/**
 * Discover gate/audit/check runner scripts in scripts/ or tools/ recursively.
 */
function detectGateScripts(
    root: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): RepoArchetypeContext['gateScripts'] {
    const gateScriptsContext: RepoArchetypeContext['gateScripts'] = {
        files: [],
        contents: {},
    };

    const scriptDirs = [
        path.join(root, 'scripts'),
        path.join(root, 'tools'),
        path.join(root, 'gate'),
        path.join(root, 'gates'),
    ];

    for (let i = 0; i < scriptDirs.length; i++) {
        const candidatePaths = getCandidateGateFiles(scriptDirs[i], 0, 2, probe);
        for (let j = 0; j < candidatePaths.length; j++) {
            const filePath = candidatePaths[j];
            const rel = path.relative(root, filePath).replace(/\\/g, '/');
            gateScriptsContext.files.push(rel);
            const content = safeReadFile(filePath, probe);
            if (content !== undefined) {
                gateScriptsContext.contents[rel] = content;
            }
        }
    }

    return gateScriptsContext;
}

const TOPOLOGY_IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    'testdata',
    '.github',
    '.vscode',
    'archive',
    'docs',
    'target',
    'bin',
    'obj',
]);

interface ManifestMapping {
    fileName: string;
    archetype: ProjectArchetype;
}

const MANIFEST_ARCHETYPE_MAPPINGS: readonly ManifestMapping[] = [
    { fileName: 'Cargo.toml', archetype: 'rust' },
    { fileName: 'pyproject.toml', archetype: 'python' },
    { fileName: 'requirements.txt', archetype: 'python' },
    { fileName: 'go.mod', archetype: 'go' },
    { fileName: 'project.godot', archetype: 'godot' },
];

/**
 * Extracts the `name` property from a package.json file if present.
 */
function extractPackageName(
    pkgPath: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): string | undefined {
    const content = safeReadFile(pkgPath, probe);
    if (!content) return undefined;
    try {
        const parsed = JSON.parse(content);
        return typeof parsed.name === 'string' ? parsed.name : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Sniff directory archetype and manifest path.
 *
 * @param dirPath - Directory to inspect.
 * @param probe - Filesystem probe driver.
 * @returns Archetype and manifest path if detected.
 */
export function computeDirectoryArchetype(
    dirPath: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): { archetype: ProjectArchetype; manifestPath: string; name?: string } | undefined {
    const pkgPath = path.join(dirPath, 'package.json');
    if (probe.checkExists(pkgPath)) {
        return {
            archetype: 'node',
            [KEY_MANIFEST_PATH]: pkgPath,
            name: extractPackageName(pkgPath, probe),
        };
    }

    for (let i = 0; i < MANIFEST_ARCHETYPE_MAPPINGS.length; i++) {
        const mapping = MANIFEST_ARCHETYPE_MAPPINGS[i];
        const candidateManifestPath = path.join(dirPath, mapping.fileName);
        if (probe.checkExists(candidateManifestPath)) {
            return { archetype: mapping.archetype, [KEY_MANIFEST_PATH]: candidateManifestPath };
        }
    }
    return undefined;
}

/**
 * Scans top-level candidate directories for subproject manifests.
 */
function scanDirectoryClusterSubprojects(
    absRoot: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): DiscoveredSubproject[] {
    const subprojects: DiscoveredSubproject[] = [];
    const entries = safeReadDir(absRoot, probe);

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (TOPOLOGY_IGNORED_DIRS.has(entry)) continue;
        const entryPath = path.join(absRoot, entry);
        try {
            const stat = probe.getFileStat(entryPath);
            if (!stat || !stat.isDirectory()) continue;
        } catch {
            continue;
        }

        const sniffed = computeDirectoryArchetype(entryPath, probe);
        if (sniffed) {
            subprojects.push({
                name: entry,
                relPath: entry,
                archetype: sniffed.archetype,
                [KEY_MANIFEST_PATH]: path
                    .relative(absRoot, sniffed.manifestPath)
                    .replace(/\\/g, '/'),
            });
        }
    }
    return subprojects;
}

/**
 * Scans a single nested workspace container directory for subprojects.
 */
function scanContainerEntries(
    absRoot: string,
    containerPath: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): DiscoveredSubproject[] {
    if (!probe.checkExists(containerPath)) {
        return [];
    }
    const containerStat = probe.getFileStat(containerPath);
    if (!containerStat || !containerStat.isDirectory()) {
        return [];
    }
    const subprojects: DiscoveredSubproject[] = [];
    const entries = safeReadDir(containerPath, probe);
    for (let i = 0; i < entries.length; i++) {
        const subName = entries[i];
        const subPath = path.join(containerPath, subName);
        const sniffed = computeDirectoryArchetype(subPath, probe);
        if (!sniffed) continue;
        subprojects.push({
            name: subName,
            relPath: path.relative(absRoot, subPath).replace(/\\/g, '/'),
            archetype: sniffed.archetype,
            [KEY_MANIFEST_PATH]: path.relative(absRoot, sniffed.manifestPath).replace(/\\/g, '/'),
        });
    }
    return subprojects;
}

/**
 * Computes explicit workspace configuration and returns populated RepoTopology.
 *
 * @param absRoot - Absolute repository root.
 * @param monorepoType - Detected monorepo classification.
 * @param detectionSource - Detection provenance source.
 * @param probe - Filesystem probe driver.
 * @returns Fully populated RepoTopology context.
 */
export function computeExplicitSubprojects(
    absRoot: string,
    monorepoType: MonorepoType,
    detectionSource: RepoTopology['detectionSource'],
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): RepoTopology {
    const subprojects: DiscoveredSubproject[] = scanDirectoryClusterSubprojects(absRoot, probe);
    const nestedContainers = ['packages', 'apps', 'crates', 'services', 'libs'];
    for (let i = 0; i < nestedContainers.length; i++) {
        const containerPath = path.join(absRoot, nestedContainers[i]);
        const nested = scanContainerEntries(absRoot, containerPath, probe);
        subprojects.push(...nested);
    }

    return {
        isMonorepo: true,
        [KEY_MONOREPO_TYPE]: monorepoType,
        [KEY_PROJECT_COUNT]: subprojects.length,
        subprojects,
        [KEY_DETECTION_SOURCE]: detectionSource,
    };
}

interface SimpleWorkspaceMapping {
    file: string;
    type: MonorepoType;
}

const SIMPLE_WORKSPACE_FILES: readonly SimpleWorkspaceMapping[] = [
    { file: 'pnpm-workspace.yaml', type: 'pnpm-workspaces' },
    { file: 'go.work', type: 'go-work' },
    { file: 'turbo.json', type: 'turbo' },
    { file: 'lerna.json', type: 'lerna' },
    { file: 'nx.json', type: 'nx' },
];

/**
 * Checks whether root package.json defines node workspaces.
 *
 * @param absRoot - Absolute path to workspace root.
 * @param probe - Optional filesystem probe.
 * @returns True if workspaces field is present.
 */
export function hasNodeWorkspaces(
    absRoot: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): boolean {
    const pkgPath = path.join(absRoot, 'package.json');
    if (!probe.checkExists(pkgPath)) return false;
    const content = safeReadFile(pkgPath, probe);
    if (!content) return false;
    try {
        return Boolean(JSON.parse(content).workspaces);
    } catch {
        return false;
    }
}

/**
 * Checks whether root Cargo.toml defines cargo workspaces.
 *
 * @param absRoot - Absolute path to workspace root.
 * @param probe - Optional filesystem probe.
 * @returns True if [workspace] section is present.
 */
export function hasCargoWorkspace(
    absRoot: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): boolean {
    const cargoPath = path.join(absRoot, 'Cargo.toml');
    if (!probe.checkExists(cargoPath)) return false;
    const content = safeReadFile(cargoPath, probe);
    return Boolean(content && /^\s*\[workspace\]/m.test(content));
}

/**
 * Detect explicit workspace configuration manifest files.
 */
function detectExplicitWorkspaceManifest(
    absRoot: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): MonorepoType | null {
    if (hasNodeWorkspaces(absRoot, probe)) return 'npm-workspaces';
    if (hasCargoWorkspace(absRoot, probe)) return 'cargo-workspace';

    for (let i = 0; i < SIMPLE_WORKSPACE_FILES.length; i++) {
        const entry = SIMPLE_WORKSPACE_FILES[i];
        if (probe.checkExists(path.join(absRoot, entry.file))) {
            return entry.type;
        }
    }
    return null;
}

/**
 * Sniff repository topology to distinguish Monorepo from Single-Project.
 *
 * @param absRoot - Absolute root path of repository.
 * @param probe - Filesystem probe driver.
 * @returns RepoTopology with isMonorepo boolean and discovered subprojects.
 */
export function detectRepoTopology(
    absRoot: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): RepoTopology {
    // --- Tier 1: Explicit Monorepo Manifests ---
    const explicitType = detectExplicitWorkspaceManifest(absRoot, probe);
    if (explicitType) {
        return computeExplicitSubprojects(absRoot, explicitType, 'explicit-manifest', probe);
    }

    // --- Tier 2: Directory Cluster Sniffing (Implicit multi-project) ---
    const subprojects = scanDirectoryClusterSubprojects(absRoot, probe);
    if (subprojects.length >= 2) {
        return {
            isMonorepo: true,
            [KEY_MONOREPO_TYPE]: 'directory-cluster',
            [KEY_PROJECT_COUNT]: subprojects.length,
            subprojects,
            [KEY_DETECTION_SOURCE]: 'directory-cluster',
        };
    }

    // --- Tier 3: Single-Root or Single-Subproject Fallback ---
    if (subprojects.length === 1) {
        return {
            isMonorepo: false,
            [KEY_MONOREPO_TYPE]: 'none',
            [KEY_PROJECT_COUNT]: 1,
            subprojects,
            primaryProjectName: subprojects[0].name,
            [KEY_DETECTION_SOURCE]: 'directory-cluster',
        };
    }

    const rootArchetype = computeDirectoryArchetype(absRoot, probe);
    if (rootArchetype) {
        const rootName = path.basename(absRoot);
        return {
            isMonorepo: false,
            [KEY_MONOREPO_TYPE]: 'none',
            [KEY_PROJECT_COUNT]: 1,
            subprojects: [
                {
                    name: rootName,
                    relPath: '.',
                    archetype: rootArchetype.archetype,
                    [KEY_MANIFEST_PATH]: path
                        .relative(absRoot, rootArchetype.manifestPath)
                        .replace(/\\/g, '/'),
                },
            ],
            primaryProjectName: rootName,
            [KEY_DETECTION_SOURCE]: 'single-root',
        };
    }

    return {
        isMonorepo: false,
        [KEY_MONOREPO_TYPE]: 'none',
        [KEY_PROJECT_COUNT]: 0,
        subprojects: [],
        [KEY_DETECTION_SOURCE]: 'generic',
    };
}

/**
 * Inspect a repository root and construct its complete archetype context.
 *
 * @param root - Absolute or relative path to the repository root.
 * @param probe - Filesystem probe driver.
 * @returns Comprehensive RepoArchetypeContext.
 */
export function inspectRepoArchetype(
    root: string,
    probe: FileSystemProbe = DEFAULT_FS_PROBE,
): RepoArchetypeContext {
    clearArchetypeFileCache();
    const absRoot = path.resolve(root);
    const { archetypes, manifests, packageManager, scriptsAvailable } = detectArchetypes(
        absRoot,
        probe,
    );

    let primaryArchetype: ProjectArchetype = 'generic';
    if (archetypes.length > 1) {
        primaryArchetype = 'polyglot';
    } else if (archetypes.length === 1) {
        primaryArchetype = archetypes[0];
    }

    const hooks = detectHooks(absRoot, probe);
    const ci = detectCi(absRoot, probe);
    const gateScripts = detectGateScripts(absRoot, probe);
    const topology = detectRepoTopology(absRoot, probe);

    return {
        root: absRoot,
        archetypes,
        primaryArchetype,
        topology,
        packageManager,
        manifests,
        scriptsAvailable,
        hooks,
        ci,
        gateScripts,
    };
}

/* =========================================================================
 * Backward Compatibility Aliases
 * ========================================================================= */

/** @deprecated Use `inspectRepoArchetype` instead. */
export const sniffRepoArchetype = inspectRepoArchetype;
/** @deprecated Use `computeDirectoryArchetype` instead. */
export const sniffDirectoryArchetype = computeDirectoryArchetype;
/** @deprecated Use `computeExplicitSubprojects` instead. */
export const sniffExplicitWorkspaceSubprojects = computeExplicitSubprojects;
/** @deprecated Use `getCandidateGateFiles` instead. */
export const collectCandidateGateFiles = getCandidateGateFiles;
/** @deprecated Use `hasNodeWorkspaces` instead. */
export const hasNpmWorkspaces = hasNodeWorkspaces;
