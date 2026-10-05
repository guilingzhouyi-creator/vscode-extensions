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

function safeReadFile(filePath: string): string | undefined {
    try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch {
        // Ignored on permission or read failure
    }
    return undefined;
}

function safeReadDir(dirPath: string): string[] {
    try {
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            return fs.readdirSync(dirPath);
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
 * @returns Detected Node package manager or undefined.
 */
function detectNodeArchetype(
    root: string,
    manifests: RepoArchetypeContext['manifests'],
    scriptsAvailable: string[],
): PackageManager | undefined {
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) return undefined;

    manifests.packageJson = true;
    const pkgContent = safeReadFile(pkgPath);
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

    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
    return 'npm';
}

/**
 * Detect Python archetype manifests and package manager.
 *
 * @param root - Absolute repository root path.
 * @param manifests - Manifest record accumulator.
 * @returns Detected Python package manager or undefined.
 */
function detectPythonArchetype(
    root: string,
    manifests: RepoArchetypeContext['manifests'],
): PackageManager | undefined {
    const hasPyproject = fs.existsSync(path.join(root, 'pyproject.toml'));
    const hasRequirements = fs.existsSync(path.join(root, 'requirements.txt'));
    const hasSetupPy = fs.existsSync(path.join(root, 'setup.py'));

    if (!hasPyproject && !hasRequirements && !hasSetupPy) return undefined;

    manifests.pyprojectToml = hasPyproject;
    manifests.requirementsTxt = hasRequirements;
    return fs.existsSync(path.join(root, 'poetry.lock')) ? 'poetry' : 'pip';
}

/**
 * Sniff repository archetype from root manifests.
 */
function detectArchetypes(root: string): {
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
    const nodePm = detectNodeArchetype(root, manifests, scriptsAvailable);
    if (nodePm) {
        archetypes.push('node');
        packageManager = nodePm;
    }

    // Rust
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
        manifests.cargoToml = true;
        archetypes.push('rust');
        if (!packageManager) packageManager = 'cargo';
    }

    // Python ecosystem archetype detection
    const pyPm = detectPythonArchetype(root, manifests);
    if (pyPm) {
        archetypes.push('python');
        if (!packageManager) packageManager = pyPm;
    }

    // Go modules archetype detection
    if (fs.existsSync(path.join(root, 'go.mod'))) {
        manifests.goMod = true;
        archetypes.push('go');
        if (!packageManager) packageManager = 'gomod';
    }

    // Godot engine archetype detection
    if (fs.existsSync(path.join(root, 'project.godot'))) {
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
 * @param result - Hook discovery result accumulator.
 */
function classifyHookFile(
    entry: string,
    entryPath: string,
    content: string,
    result: RepoArchetypeContext['hooks'],
): void {
    result.allHookFiles.push(entry);
    if (entry === 'pre-commit' || entry === 'pre-commit.sh') {
        result.preCommit = { name: entry, filePath: entryPath, content };
        return;
    }
    if (entry === 'commit-msg' || entry === 'commit-msg.sh') {
        result.commitMsg = { name: entry, filePath: entryPath, content };
        return;
    }
    if (entry === 'pre-push' || entry === 'pre-push.sh') {
        result.prePush = { name: entry, filePath: entryPath, content };
    }
}

/**
 * Discover Git hooks configuration and hook files.
 */
function detectHooks(root: string): RepoArchetypeContext['hooks'] {
    const result: RepoArchetypeContext['hooks'] = {
        allHookFiles: [],
    };

    // 1. Check core.hooksPath in .git/config if present
    const gitConfigPath = path.join(root, '.git', 'config');
    const gitConfig = safeReadFile(gitConfigPath);
    if (gitConfig) {
        const match = gitConfig.match(/hooksPath\s*=\s*(.+)/i);
        if (match && match[1]) {
            result.hooksPathConfig = match[1].trim();
        }
    }

    // Candidate hook directories in priority order
    const candidateDirs = [
        result.hooksPathConfig ? path.resolve(root, result.hooksPathConfig) : undefined,
        path.join(root, '.githooks'),
        path.join(root, '.husky'),
        path.join(root, '.git', 'hooks'),
    ].filter((dir): dir is string => typeof dir === 'string' && fs.existsSync(dir));

    if (candidateDirs.length === 0) {
        return result;
    }

    const hookDir = candidateDirs[0];
    result.hookDir = path.relative(root, hookDir).replace(/\\/g, '/') || hookDir;
    const entries = safeReadDir(hookDir);

    for (const entry of entries) {
        const entryPath = path.join(hookDir, entry);
        const content = safeReadFile(entryPath);
        if (content !== undefined) {
            classifyHookFile(entry, entryPath, content, result);
        }
    }

    return result;
}

/**
 * Discover CI configuration files.
 */
function detectCi(root: string): RepoArchetypeContext['ci'] {
    const result: RepoArchetypeContext['ci'] = {
        workflowFiles: [],
        workflowContents: {},
    };

    // GitHub Actions
    const ghWorkflowsDir = path.join(root, '.github', 'workflows');
    if (fs.existsSync(ghWorkflowsDir)) {
        result.platform = 'github';
        const files = safeReadDir(ghWorkflowsDir).filter(
            (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
        );
        for (const file of files) {
            const filePath = path.join(ghWorkflowsDir, file);
            const content = safeReadFile(filePath);
            if (content !== undefined) {
                result.workflowFiles.push(`.github/workflows/${file}`);
                result.workflowContents[`.github/workflows/${file}`] = content;
            }
        }
    }

    // GitLab CI
    const gitlabCiPath = path.join(root, '.gitlab-ci.yml');
    if (fs.existsSync(gitlabCiPath)) {
        if (!result.platform) result.platform = 'gitlab';
        const content = safeReadFile(gitlabCiPath);
        if (content !== undefined) {
            result.workflowFiles.push('.gitlab-ci.yml');
            result.workflowContents['.gitlab-ci.yml'] = content;
        }
    }

    // CircleCI
    const circleCiPath = path.join(root, '.circleci', 'config.yml');
    if (fs.existsSync(circleCiPath)) {
        if (!result.platform) result.platform = 'circleci';
        const content = safeReadFile(circleCiPath);
        if (content !== undefined) {
            result.workflowFiles.push('.circleci/config.yml');
            result.workflowContents['.circleci/config.yml'] = content;
        }
    }

    return result;
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
 * Recursively collect candidate gate script paths up to bounded depth.
 *
 * @param dirPath - Current directory path.
 * @param depth - Current recursion depth (0-indexed).
 * @param maxDepth - Maximum recursion depth.
 * @returns Array of absolute file paths matching gate patterns.
 */
function collectCandidateGateFiles(dirPath: string, depth = 0, maxDepth = 2): string[] {
    if (depth > maxDepth || !fs.existsSync(dirPath)) return [];
    const files: string[] = [];
    const entries = safeReadDir(dirPath);

    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__') {
            continue;
        }
        const full = path.join(dirPath, entry);
        try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                files.push(...collectCandidateGateFiles(full, depth + 1, maxDepth));
            } else if (stat.isFile() && isCandidateGateFileName(entry)) {
                files.push(full);
            }
        } catch {
            // Ignored on stat permission failure
        }
    }
    return files;
}

/**
 * Discover gate/audit/check runner scripts in scripts/ or tools/ recursively.
 */
function detectGateScripts(root: string): RepoArchetypeContext['gateScripts'] {
    const result: RepoArchetypeContext['gateScripts'] = {
        files: [],
        contents: {},
    };

    const scriptDirs = [
        path.join(root, 'scripts'),
        path.join(root, 'tools'),
        path.join(root, 'gate'),
        path.join(root, 'gates'),
    ];

    for (const dir of scriptDirs) {
        const candidatePaths = collectCandidateGateFiles(dir);
        for (const filePath of candidatePaths) {
            const content = safeReadFile(filePath);
            if (content !== undefined) {
                const rel = path.relative(root, filePath).replace(/\\/g, '/');
                result.files.push(rel);
                result.contents[rel] = content;
            }
        }
    }

    return result;
}

const TOPOLOGY_IGNORED_DIRS = new Set([
    '.git',
    '.githooks',
    '.husky',
    '.github',
    '.gitlab',
    '.vscode',
    '.idea',
    'node_modules',
    'dist',
    'build',
    'target',
    'vendor',
    'coverage',
    'reports',
    'archive',
    'docs',
    'doc',
    'scripts',
    'tools',
    '.agents',
    '.gemini',
    'tmp',
    'temp',
    'scratch',
]);

/**
 * Sniff directory archetype and manifest path.
 */
function sniffDirectoryArchetype(
    dirPath: string,
): { archetype: ProjectArchetype; manifestPath: string; name?: string } | undefined {
    const pkgPath = path.join(dirPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
        let name: string | undefined;
        const content = safeReadFile(pkgPath);
        if (content) {
            try {
                const parsed = JSON.parse(content);
                if (typeof parsed.name === 'string' && parsed.name) {
                    name = parsed.name;
                }
            } catch {
                // ignore JSON parse failure
            }
        }
        return { archetype: 'node', manifestPath: pkgPath, name };
    }
    const cargoPath = path.join(dirPath, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
        return { archetype: 'rust', manifestPath: cargoPath };
    }
    const godotPath = path.join(dirPath, 'project.godot');
    if (fs.existsSync(godotPath)) {
        return { archetype: 'godot', manifestPath: godotPath };
    }
    const pyprojectPath = path.join(dirPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
        return { archetype: 'python', manifestPath: pyprojectPath };
    }
    const reqPath = path.join(dirPath, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
        return { archetype: 'python', manifestPath: reqPath };
    }
    const goModPath = path.join(dirPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
        return { archetype: 'go', manifestPath: goModPath };
    }
    return undefined;
}

/**
 * Scans top-level candidate directories for subproject manifests.
 */
function scanDirectoryClusterSubprojects(absRoot: string): DiscoveredSubproject[] {
    const subprojects: DiscoveredSubproject[] = [];
    const entries = safeReadDir(absRoot);

    for (const entry of entries) {
        if (TOPOLOGY_IGNORED_DIRS.has(entry)) continue;
        const entryPath = path.join(absRoot, entry);
        try {
            if (!fs.statSync(entryPath).isDirectory()) continue;
        } catch {
            continue;
        }

        const sniffed = sniffDirectoryArchetype(entryPath);
        if (sniffed) {
            subprojects.push({
                name: entry,
                relPath: entry,
                archetype: sniffed.archetype,
                manifestPath: path.relative(absRoot, sniffed.manifestPath).replace(/\\/g, '/'),
            });
        }
    }
    return subprojects;
}

/**
 * Scans a single nested workspace container directory for subprojects.
 */
function scanContainerEntries(absRoot: string, containerPath: string): DiscoveredSubproject[] {
    if (!fs.existsSync(containerPath) || !fs.statSync(containerPath).isDirectory()) {
        return [];
    }
    const subprojects: DiscoveredSubproject[] = [];
    const entries = safeReadDir(containerPath);
    for (const n of entries) {
        const subPath = path.join(containerPath, n);
        const sniffed = sniffDirectoryArchetype(subPath);
        if (!sniffed) continue;
        subprojects.push({
            name: n,
            relPath: path.relative(absRoot, subPath).replace(/\\/g, '/'),
            archetype: sniffed.archetype,
            manifestPath: path.relative(absRoot, sniffed.manifestPath).replace(/\\/g, '/'),
        });
    }
    return subprojects;
}

/**
 * Sniffs explicit workspace configuration and returns populated RepoTopology.
 */
function sniffExplicitWorkspaceSubprojects(
    absRoot: string,
    monorepoType: MonorepoType,
    detectionSource: RepoTopology['detectionSource'],
): RepoTopology {
    const subprojects: DiscoveredSubproject[] = scanDirectoryClusterSubprojects(absRoot);
    const nestedContainers = ['packages', 'apps', 'crates', 'services', 'libs'];
    for (const container of nestedContainers) {
        const containerPath = path.join(absRoot, container);
        const nested = scanContainerEntries(absRoot, containerPath);
        subprojects.push(...nested);
    }

    return {
        isMonorepo: true,
        monorepoType,
        projectCount: subprojects.length,
        subprojects,
        detectionSource,
    };
}

/**
 * Detect explicit workspace configuration manifest files.
 */
function detectExplicitWorkspaceManifest(absRoot: string): MonorepoType | null {
    const pkgPath = path.join(absRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkgContent = safeReadFile(pkgPath);
        if (pkgContent) {
            try {
                if (JSON.parse(pkgContent).workspaces) return 'npm-workspaces';
            } catch {
                // ignore
            }
        }
    }
    if (fs.existsSync(path.join(absRoot, 'pnpm-workspace.yaml'))) return 'pnpm-workspaces';
    const cargoPath = path.join(absRoot, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
        const cargoContent = safeReadFile(cargoPath);
        if (cargoContent && /^\s*\[workspace\]/m.test(cargoContent)) return 'cargo-workspace';
    }
    if (fs.existsSync(path.join(absRoot, 'go.work'))) return 'go-work';
    if (fs.existsSync(path.join(absRoot, 'turbo.json'))) return 'turbo';
    if (fs.existsSync(path.join(absRoot, 'lerna.json'))) return 'lerna';
    if (fs.existsSync(path.join(absRoot, 'nx.json'))) return 'nx';
    return null;
}

/**
 * Sniff repository topology to distinguish Monorepo from Single-Project.
 *
 * @param absRoot - Absolute root path of repository.
 * @returns RepoTopology with isMonorepo boolean and discovered subprojects.
 */
export function detectRepoTopology(absRoot: string): RepoTopology {
    // --- Tier 1: Explicit Monorepo Manifests ---
    const explicitType = detectExplicitWorkspaceManifest(absRoot);
    if (explicitType) {
        return sniffExplicitWorkspaceSubprojects(absRoot, explicitType, 'explicit-manifest');
    }

    // --- Tier 2: Directory Cluster Sniffing (Implicit multi-project) ---
    const subprojects = scanDirectoryClusterSubprojects(absRoot);
    if (subprojects.length >= 2) {
        return {
            isMonorepo: true,
            monorepoType: 'directory-cluster',
            projectCount: subprojects.length,
            subprojects,
            detectionSource: 'directory-cluster',
        };
    }

    // --- Tier 3: Single-Root or Single-Subproject Fallback ---
    if (subprojects.length === 1) {
        return {
            isMonorepo: false,
            monorepoType: 'none',
            projectCount: 1,
            subprojects,
            primaryProjectName: subprojects[0].name,
            detectionSource: 'directory-cluster',
        };
    }

    const rootArchetype = sniffDirectoryArchetype(absRoot);
    if (rootArchetype) {
        const rootName = path.basename(absRoot);
        return {
            isMonorepo: false,
            monorepoType: 'none',
            projectCount: 1,
            subprojects: [
                {
                    name: rootName,
                    relPath: '.',
                    archetype: rootArchetype.archetype,
                    manifestPath: path
                        .relative(absRoot, rootArchetype.manifestPath)
                        .replace(/\\/g, '/'),
                },
            ],
            primaryProjectName: rootName,
            detectionSource: 'single-root',
        };
    }

    return {
        isMonorepo: false,
        monorepoType: 'none',
        projectCount: 0,
        subprojects: [],
        detectionSource: 'generic',
    };
}

/**
 * Inspect a repository root and construct its complete archetype context.
 *
 * @param root - Absolute or relative path to the repository root.
 * @returns Comprehensive RepoArchetypeContext.
 */
export function inspectRepoArchetype(root: string): RepoArchetypeContext {
    const absRoot = path.resolve(root);
    const { archetypes, manifests, packageManager, scriptsAvailable } = detectArchetypes(absRoot);

    let primaryArchetype: ProjectArchetype = 'generic';
    if (archetypes.length > 1) {
        primaryArchetype = 'polyglot';
    } else if (archetypes.length === 1) {
        primaryArchetype = archetypes[0];
    }

    const hooks = detectHooks(absRoot);
    const ci = detectCi(absRoot);
    const gateScripts = detectGateScripts(absRoot);
    const topology = detectRepoTopology(absRoot);

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
