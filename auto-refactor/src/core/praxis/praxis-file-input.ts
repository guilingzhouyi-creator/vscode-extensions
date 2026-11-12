/**
 * Module: Core Praxis — Root-Confined File Input
 * File Path: src/core/praxis/praxis-file-input.ts
 * Architecture Role: Filesystem boundary for the public single-file review API.
 * Dependencies & Triggers: Node filesystem, path, UTF-8 decoder; consumed by PraxisReviewClient.
 * Responsibilities: Resolve review roots, reject escapes, preserve I/O errors, and decode strictly.
 * Exit Semantics & Design Rationale: Reject read errors and invalid encoding explicitly.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';

/** Error code used when a filesystem input escapes its configured review root. */
const PATH_OUTSIDE_ROOT = 'PATH_OUTSIDE_ROOT';

/**
 * Reject a resolved path outside the configured root before it can be read.
 *
 * @param root - Absolute root, lexical or canonical depending on the validation stage.
 * @param filePath - Absolute file path in the corresponding path representation.
 * @throws An error with PATH_OUTSIDE_ROOT when the path escapes the root.
 */
function assertReviewPath(root: string, filePath: string): void {
    const relative = path.relative(root, filePath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw Object.assign(new Error('Review input is outside the configured root.'), {
            code: PATH_OUTSIDE_ROOT,
        });
    }
}

/**
 * Read an explicit source string or a root-confined, strictly decoded filesystem input.
 *
 * @param filePath - File label for supplied content, or root-relative filesystem path.
 * @param content - Explicit content; an empty string is a valid supplied input.
 * @param root - Root used for lexical and canonical filesystem confinement.
 * @returns The exact supplied content or decoded UTF-8 source.
 * @throws Native filesystem errors, path confinement errors, or INVALID_ENCODING.
 * ASYNC-CONCURRENCY: read-only; both reads are awaited together and no shared state is touched.
 */
export async function readPraxisFileContent(
    filePath: string,
    content: string | undefined,
    root: string,
): Promise<string> {
    if (content !== undefined) return content;
    const absoluteRoot = path.resolve(root);
    const absoluteFile = path.resolve(absoluteRoot, filePath);
    assertReviewPath(absoluteRoot, absoluteFile);
    const [canonicalRoot, canonicalFile] = await Promise.all([
        fs.promises.realpath(absoluteRoot),
        fs.promises.realpath(absoluteFile),
    ]);
    assertReviewPath(canonicalRoot, canonicalFile);
    const bytes = await fs.promises.readFile(canonicalFile);
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (cause) {
        throw Object.assign(new Error('Review input is not valid UTF-8.', { cause }), {
            code: 'INVALID_ENCODING',
        });
    }
}
