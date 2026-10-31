/**
 * Module: Core Scoring — Symbol Reference Call Attribution
 * File Path: src/core/scoring/autonomy-reference-scan.ts
 * Architecture Role: Second phase of the in-house autonomy scan. The file walker attributes
 *   calls from import specifiers alone; this phase overwrites those counters with true AST call
 *   references from the indexed symbol graph, so a project that imports a package without ever
 *   calling it is not charged for the call.
 * Dependencies & Triggers: Consumes the symbol index, import profiles, and manifest inventory;
 *   invoked by `evaluateProjectAutonomy` when a symbol index is available.
 * Responsibilities:
 *   1. Reset the call counters before the AST-backed recount;
 *   2. Resolve each reference to internal, stdlib, or external SDK provenance;
 *   3. Memoize per-file criticality and nearest-manifest lookups across reference sites;
 *   4. Degrade an unresolvable reference to stdlib rather than inflating the SDK inventory.
 * Exit Semantics & Design Rationale: Mutates exactly one accumulator and allocates two memo
 *   tables per scan; no I/O, no throwing. Every unresolvable case degrades to stdlib on purpose —
 *   attributing an unknown call to a third party would understate self-reliance with no evidence.
 */

import { findNearestManifestInventory } from '../intelligence/dependency-provenance';
import type { ProjectManifestInventory } from '../intelligence/dependency-provenance';
import type { FileImportProfile } from '../intelligence/import-profiler';
import type { SymbolIndex, SymbolReference } from '../intelligence/symbolIndex';
import {
    KIND_INTERNAL,
    KIND_STDLIB,
    isCriticalPathFile,
    isProductionExternalSdk,
    recordSdkCall,
    type AutonomyScanState,
} from './autonomy-scan-state';
import { classifyImportProvenance } from '../intelligence/dependency-provenance';

const HASH_PRIME_MULTIPLIER = 31;

const RECEIVER_THIS = 'this';
const RECEIVER_SELF = 'self';
const RECEIVER_SUPER = 'super';
const SELF_RECEIVER_SET = new Set<string>([RECEIVER_THIS, RECEIVER_SELF, RECEIVER_SUPER]);

const COMMON_STDLIB_SYMBOLS: ReadonlySet<string> = new Set(
    (
        'push pop shift unshift slice splice join map filter reduce find includes forEach indexOf ' +
        'lastIndexOf some every concat reverse sort keys values entries assign freeze seal create ' +
        'defineProperty hasOwnProperty toString valueOf trim split replace replaceAll toLowerCase ' +
        'toUpperCase startsWith endsWith substring charAt charCodeAt match test exec now parse ' +
        'stringify log info warn error debug trace floor ceil round abs min max sqrt pow random ' +
        'setTimeout clearTimeout setInterval clearInterval resolve reject then catch finally all race ' +
        'has get set add delete clear size length bind call apply close open read write ' +
        'std core alloc Box Rc Arc RefCell Mutex RwLock Option Result Some None Ok Err ' +
        'Default Clone Copy Send Sync Debug Display Hash PartialEq Eq PartialOrd Ord ' +
        'String str Vec HashMap HashSet BTreeMap BTreeSet Instant Duration println eprintln ' +
        'format vec panic assert assert_eq assert_ne ' +
        'make len cap append copy close delete print println panic recover new Error ' +
        'Read Write Close Sprint Sprintf Sprintln Print Printf Println ' +
        'range enumerate zip issubclass getattr setattr hasattr dict tuple int ' +
        'float bool bytes bytearray sum sorted any all ' +
        'push_error push_warning randf randi randf_range randi_range deg_to_rad rad_to_deg ' +
        'clamp lerp emit_signal connect disconnect queue_free is_instance_valid get_node has_node'
    ).split(' '),
);

/** Per-scan memo tables shared while classifying symbol references. */
interface ReferenceScanCaches {
    criticalByFile: Map<string, boolean>;
    inventoryByFile: Map<string, ProjectManifestInventory>;
}

/** Immutable inputs the reference classifier needs for every call site. */
interface ReferenceScanInputs {
    symbolIndex: SymbolIndex;
    fileToExtPackages: Map<string, string[]>;
    fileToImportProfiles?: Map<string, FileImportProfile>;
    rootDir: string;
    manifestDeps?: Set<string>;
}

/**
 * Resolve (and memoize) whether a file sits on a critical execution path.
 *
 * @param file - File owning the reference.
 * @param caches - Per-scan memo tables.
 * @returns `true` when the file is production code on a critical path.
 */
function isCriticalFile(file: string, caches: ReferenceScanCaches): boolean {
    const cached = caches.criticalByFile.get(file);
    if (cached !== undefined) return cached;
    const isCritical = isCriticalPathFile(file);
    caches.criticalByFile.set(file, isCritical);
    return isCritical;
}

/**
 * Resolve (and memoize) the nearest manifest inventory for a file.
 *
 * @param file - File owning the reference.
 * @param caches - Per-scan memo tables.
 * @param rootDir - Scan root used for the nearest-manifest walk.
 * @returns The nearest manifest inventory.
 */
function resolveReferenceInventory(
    file: string,
    caches: ReferenceScanCaches,
    rootDir: string,
): ProjectManifestInventory {
    const cached = caches.inventoryByFile.get(file);
    if (cached !== undefined) return cached;
    const resolved = findNearestManifestInventory(file, rootDir);
    caches.inventoryByFile.set(file, resolved);
    return resolved;
}

/**
 * Pick which declared external package a symbol belongs to.
 *
 * A file that imports several packages gives the reference no explicit owner, so a stable hash of
 * the symbol name picks one. The choice must be deterministic: a random or arrival-order pick
 * would make the SDK inventory — and therefore the published autonomy figure — non-reproducible.
 *
 * @param extPkgs - External packages the file declared.
 * @param symbolName - Called symbol name.
 * @returns The package name to credit.
 */
function selectBalancedSdk(extPkgs: readonly string[], symbolName: string): string {
    if (extPkgs.length === 1) return extPkgs[0];
    let hash = 0;
    for (let i = 0; i < symbolName.length; i++) {
        hash = (hash * HASH_PRIME_MULTIPLIER + symbolName.charCodeAt(i)) >>> 0;
    }
    return extPkgs[hash % extPkgs.length];
}

/** Bound import reference awaiting bucket dispatch. */
interface BoundImportRefParams {
    readonly boundPkg: string;
    readonly file: string;
    readonly isCritical: boolean;
    readonly effectiveDeps?: Set<string>;
    readonly fileInv: ProjectManifestInventory;
    readonly state: AutonomyScanState;
}

/**
 * Dispatches an import-bound reference to the appropriate autonomy state bucket.
 *
 * @param params - Bound package plus the attribution context.
 */
function processBoundImportRef(params: BoundImportRefParams): void {
    const { boundPkg, file, isCritical, effectiveDeps, fileInv, state } = params;
    const boundKind = classifyImportProvenance(
        boundPkg,
        file,
        effectiveDeps,
        fileInv?.pathAliases,
    );
    if (boundKind === KIND_STDLIB) {
        state.stdlibCalls++;
        return;
    }
    if (boundKind === KIND_INTERNAL) {
        state.internalSymbolCalls++;
        if (isCritical) state.criticalPathInternalCalls++;
        return;
    }
    if (!isProductionExternalSdk(boundPkg, file, fileInv)) {
        state.stdlibCalls++;
        return;
    }
    recordSdkCall(state, boundPkg, file, isCritical);
}

/**
 * Count a reference that resolves to an in-project declaration.
 *
 * @param ref - Indexed call reference.
 * @param isCritical - Whether the referencing file is on a critical path.
 * @param symbolIndex - Materialized project symbol index.
 * @param state - Autonomy evaluation state to update.
 * @returns `true` when the reference was internal and has been counted.
 */
function countInternalReference(
    ref: SymbolReference,
    isCritical: boolean,
    symbolIndex: SymbolIndex,
    state: AutonomyScanState,
): boolean {
    if (!symbolIndex.hasDefinition(ref.name)) return false;
    state.internalSymbolCalls++;
    if (isCritical) state.criticalPathInternalCalls++;
    return true;
}

function isStdlibOrReceiver(name: string, calleeReceiver?: string | null): boolean {
    return (
        COMMON_STDLIB_SYMBOLS.has(name) ||
        (Boolean(calleeReceiver) && COMMON_STDLIB_SYMBOLS.has(calleeReceiver!))
    );
}

function isSelfReceiver(calleeReceiver?: string | null): boolean {
    return Boolean(calleeReceiver && SELF_RECEIVER_SET.has(calleeReceiver));
}

function resolveMatchedExtPackage(extPkgs: string[], ref: SymbolReference): string {
    if (ref.calleeReceiver && extPkgs.includes(ref.calleeReceiver)) {
        return ref.calleeReceiver;
    }
    if (extPkgs.includes(ref.name)) {
        return ref.name;
    }
    return selectBalancedSdk(extPkgs, ref.name);
}

interface ExternalReferenceCountParams {
    readonly ref: SymbolReference;
    readonly isCritical: boolean;
    readonly inputs: ReferenceScanInputs;
    readonly caches: ReferenceScanCaches;
    readonly state: AutonomyScanState;
}

/**
 * Count a reference that is not backed by an in-project declaration: import-bound packages,
 * common standard-library symbols, or the file's external SDK packages.
 *
 * Contract: a file with no declared external package degrades to a stdlib call rather than an
 * external SDK call, so supply-chain metrics never inflate on unresolved references.
 *
 * @param params - Reference plus its attribution context.
 */
function countExternalReference(params: ExternalReferenceCountParams): void {
    const { ref, isCritical, inputs, caches, state } = params;
    const fileInv = resolveReferenceInventory(ref.file, caches, inputs.rootDir);
    const effectiveDeps =
        fileInv.allDependencies.size > 0 ? fileInv.allDependencies : inputs.manifestDeps;

    const profile = inputs.fileToImportProfiles?.get(ref.file);
    const boundPkg =
        profile?.symbolToPackageMap.get(ref.name) ??
        (ref.calleeReceiver ? profile?.symbolToPackageMap.get(ref.calleeReceiver) : undefined);
    if (boundPkg) {
        processBoundImportRef({
            boundPkg,
            file: ref.file,
            isCritical,
            effectiveDeps,
            fileInv,
            state,
        });
        return;
    }

    if (isStdlibOrReceiver(ref.name, ref.calleeReceiver)) {
        state.stdlibCalls++;
        return;
    }

    if (isSelfReceiver(ref.calleeReceiver)) {
        state.internalSymbolCalls++;
        if (isCritical) state.criticalPathInternalCalls++;
        return;
    }

    const extPkgs = inputs.fileToExtPackages.get(ref.file);
    if (!extPkgs || extPkgs.length === 0) {
        state.stdlibCalls++;
        return;
    }

    const matchedPkg = resolveMatchedExtPackage(extPkgs, ref);
    recordSdkCall(state, matchedPkg, ref.file, isCritical);
}

/** Inputs for the AST-backed reference recount. */
export interface SymbolIndexReferenceParams {
    readonly symbolIndex: SymbolIndex;
    readonly state: AutonomyScanState;
    readonly fileToExtPackages: Map<string, string[]>;
    readonly fileToImportProfiles?: Map<string, FileImportProfile>;
    readonly rootDir?: string;
    readonly manifestDeps?: Set<string>;
}

/**
 * Overwrites call metrics with true AST call references from the indexed symbol graph
 * and local file import binding profiles.
 *
 * The counters are reset first because the file walker has already counted one call per import
 * specifier. Adding to those would double-count every imported symbol; this phase exists to
 * replace that import-based approximation with actual call sites.
 *
 * @param params - Symbol index plus the attribution context.
 */
export function applySymbolIndexReferences(params: SymbolIndexReferenceParams): void {
    const {
        symbolIndex,
        state,
        fileToExtPackages,
        fileToImportProfiles,
        rootDir = process.cwd(),
        manifestDeps,
    } = params;
    const refs = symbolIndex.getAllReferences();
    if (refs.length === 0) return;

    state.internalSymbolCalls = 0;
    state.externalSdkCalls = 0;
    state.stdlibCalls = 0;
    state.criticalPathInternalCalls = 0;
    state.criticalPathExternalCalls = 0;
    state.sdkCallCounts.clear();
    state.sdkFileSets.clear();

    const caches: ReferenceScanCaches = {
        criticalByFile: new Map<string, boolean>(),
        inventoryByFile: new Map<string, ProjectManifestInventory>(),
    };
    const inputs: ReferenceScanInputs = {
        symbolIndex,
        fileToExtPackages,
        fileToImportProfiles,
        rootDir,
        manifestDeps,
    };

    for (const ref of refs) {
        const isCritical = isCriticalFile(ref.file, caches);
        if (countInternalReference(ref, isCritical, symbolIndex, state)) continue;
        countExternalReference({ ref, isCritical, inputs, caches, state });
    }
}
