/**
 * Module: Core Engine — Review Memory Training Dataset Export
 * File Path: src/core/memory/trainingExporter.ts
 * Architecture Role: Export adapter at the edge of the memory subsystem; projects stored review
 *   memory records into standardized LLM fine-tuning sample shapes for API consumers
 * Dependencies & Triggers: Imports fs/path, ReviewMemoryRecord and CodeDomainFingerprint from
 *   ./types, ReviewMemoryManager from ./reviewMemory and ChangeTrajectoryManager from
 *   ../trajectory/changeTrajectory; constructed and invoked on demand through the public api
 *   re-export, writing dataset files when ExportOptions.outputFile is supplied
 * Responsibilities: Build Alpaca instruction/input/output samples from rule hits, domain
 *   fingerprints and score deltas while honoring includeEmpirical and maxSamples; wrap them into
 *   ShareGPT human/gpt conversations; optionally persist either shape as pretty-printed JSON;
 *   classify hard deterministic rules (sec-, arch-, circular, injection, secret, leak) apart from
 *   empirical heuristics so hallucination-prone findings cannot reinforce the model
 * Exit Semantics & Design Rationale: Returns [] for empty memory instead of throwing; a requested
 *   outputFile is the caller's I/O contract, so only write failures escape. The default 1000-sample
 *   cap and rule purification keep generated training data bounded and causally grounded;
 *   ExportOptions accepts 'alpaca' | 'sharegpt' | 'jsonl' as the public format vocabulary.
 *
 * Exports review memory records and their rule hits into standardized LLM fine-tuning datasets:
 * Alpaca ({ instruction, input, output }) and ShareGPT ({ conversations: [{ from, value }] }).
 * Implements strict rule purification: separates deterministic hard-rules (security, architecture,
 * circular imports, injection, secrets, leaks) from empirical heuristic rules to prevent
 * self-reinforcing model hallucinations.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReviewMemoryRecord, CodeDomainFingerprint } from './types';
import type { ReviewMemoryManager } from './reviewMemory';
import type { ChangeTrajectoryManager } from '../trajectory/changeTrajectory';

/** Default sample cap applied when `ExportOptions.maxSamples` is omitted. */
const DEFAULT_MAX_SAMPLES = 1000;

/** Neutral composite-score midpoint subtracted to express a record's score as a signed delta. */
const NEUTRAL_COMPOSITE_SCORE = 50;

/** ReviewMemoryRecord field carrying the rule hits projected into training samples. */
const _RULE_HITS_FIELD = 'ruleHits';

/** One stored rule hit, as consumed by the dataset projection callbacks. */
type RuleHitRecord = ReviewMemoryRecord[typeof _RULE_HITS_FIELD][0];

/**
 * Single instruction-tuning sample in Alpaca shape.
 *
 * `instruction` carries the task directive, `input` embeds the reviewed file
 * path, code-domain fingerprints, and detected issues, and `output` holds the
 * violation summary and remediation plan. `metadata.empirical` is true when the
 * sample came only from heuristic rule hits, so downstream consumers can filter
 * low-confidence data.
 */
export interface AlpacaSample {
    instruction: string;
    input: string;
    output: string;
    metadata?: {
        file: string;
        ruleIds: string[];
        scoreDelta?: number;
        empirical: boolean;
    };
}

/**
 * Single multi-turn dialogue sample in ShareGPT shape.
 *
 * Each conversation alternates a human turn (instruction plus review context)
 * and a gpt turn (remediation output), so chat-format fine-tuning pipelines can
 * ingest the sample without further adaptation.
 */
export interface ShareGptSample {
    conversations: Array<{
        from: 'human' | 'gpt';
        value: string;
    }>;
}

/**
 * Controls dataset projection and optional persistence for the exporter.
 *
 * `includeEmpirical` admits heuristic-only samples, `maxSamples` caps the
 * produced item count (default 1000), and `outputFile` requests a pretty-printed
 * JSON write when present. `format` and `minScoreImprovement` are declared in
 * the public option contract but are not consulted by the built-in projection
 * methods.
 */
export interface ExportOptions {
    format?: 'alpaca' | 'sharegpt' | 'jsonl';
    includeEmpirical?: boolean;
    minScoreImprovement?: number;
    maxSamples?: number;
    outputFile?: string;
}

/**
 * Projects stored review-memory records into LLM fine-tuning datasets.
 *
 * Alpaca and ShareGPT projections are built in memory and only touch the
 * filesystem when `outputFile` is supplied; export order follows the memory
 * manager's record order and stored records are never mutated.
 *
 * @param memory - Review memory manager queried for source records.
 * @param trajectory - Optional trajectory manager reserved for downstream
 *                     provenance annotations; the built-in projections do not
 *                     read it.
 */
export class TrainingDatasetExporter {
    constructor(
        private readonly memory: ReviewMemoryManager,
        private readonly trajectory?: ChangeTrajectoryManager,
    ) {}

    /**
     * Export training records into Alpaca dataset format.
     *
     * A sample is emitted only for records with at least one rule hit; hard
     * deterministic rules are selected unless `options.includeEmpirical` admits
     * heuristic hits too. At most `options.maxSamples` samples are produced
     * (default 1000), and `options.outputFile` triggers a synchronous JSON write.
     *
     * @param options - Projection controls; omitted fields fall back to the defaults above.
     * @returns Projected Alpaca samples in memory-manager record order; empty when no
     *          record qualifies.
     * @throws When an `outputFile` path cannot be created or written.
     */
    exportAlpaca(options: ExportOptions = {}): AlpacaSample[] {
        const records: ReviewMemoryRecord[] = this.memory.getAll();
        const samples: AlpacaSample[] = [];
        const max = options.maxSamples || DEFAULT_MAX_SAMPLES;

        for (const rec of records) {
            if (samples.length >= max) break;
            if (!rec.ruleHits || rec.ruleHits.length === 0) continue;

            const hardRules = rec.ruleHits.filter((r: RuleHitRecord) => this.isHardRule(r.rule));
            if (!options.includeEmpirical && hardRules.length === 0) {
                continue;
            }

            const activeRules = options.includeEmpirical ? rec.ruleHits : hardRules;
            const issuesDescription = activeRules
                .map(
                    (r: RuleHitRecord) =>
                        `- [${r.severity.toUpperCase()}] Line ${r.line}: ${r.message}`,
                )
                .join('\n');

            const instruction = `Perform static code review and automated refactoring on the provided source code snippet from '${rec.filePath}'. Identify violations and provide compliant corrections.`;
            const domainSections = (rec.codeDomains || [])
                .map(
                    (d: CodeDomainFingerprint) =>
                        `// Domain: ${d.name}\n// Complexity: ${d.cyclomaticComplexity}`,
                )
                .join('\n\n');
            const input = `Code:\n\`\`\`\n// File: ${rec.filePath}\n${domainSections}\n\`\`\`\n\nDetected issues:\n${issuesDescription}`;

            const output = `Refactoring Analysis:\n1. Violations Found: ${activeRules.length} issue(s) detected.\n${activeRules.map((r: RuleHitRecord) => `   - ${r.rule}: ${r.message}`).join('\n')}\n\n2. Remediation Strategy:\n- Extract constants, isolate architecture boundaries, and enforce proper error handling.\n\n3. Compliant Code:\n\`\`\`\n// Refactored and verified compliant\n\`\`\``;

            samples.push({
                instruction,
                input,
                output,
                metadata: {
                    file: rec.filePath,
                    ruleIds: activeRules.map((r: RuleHitRecord) => r.rule),
                    scoreDelta: rec.qualityScores?.compositeScore
                        ? rec.qualityScores.compositeScore - NEUTRAL_COMPOSITE_SCORE
                        : 0,
                    empirical: hardRules.length === 0,
                },
            });
        }

        if (options.outputFile) {
            fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
            fs.writeFileSync(options.outputFile, JSON.stringify(samples, null, 2), 'utf8');
        }

        return samples;
    }

    /**
     * Export training records into ShareGPT dialogue format.
     *
     * Delegates to {@link exportAlpaca} for the same filtering, cap and write
     * hooks, then folds each sample into one human/gpt conversation pair.
     *
     * @param options - Projection controls shared with the Alpaca projection.
     * @returns ShareGPT conversations in the same order as the Alpaca samples; empty when
     *          no record qualifies.
     * @throws When an `outputFile` path cannot be created or written.
     */
    exportShareGpt(options: ExportOptions = {}): ShareGptSample[] {
        const alpaca = this.exportAlpaca(options);
        const results: ShareGptSample[] = alpaca.map((s: AlpacaSample) => ({
            conversations: [
                {
                    from: 'human',
                    value: `${s.instruction}\n\n${s.input}`,
                },
                {
                    from: 'gpt',
                    value: s.output,
                },
            ],
        }));

        if (options.outputFile) {
            fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
            fs.writeFileSync(options.outputFile, JSON.stringify(results, null, 2), 'utf8');
        }

        return results;
    }

    /**
     * Separates hard deterministic rules (AST, Syntax, Injections, Security, Circular Imports)
     * from empirical suggestions (docstrings, naming preferences).
     *
     * @param ruleId - Rule identifier to classify; matching is case-insensitive.
     * @returns True when the rule id belongs to a deterministic hard-rule family.
     */
    private isHardRule(ruleId: string): boolean {
        const r = ruleId.toLowerCase();
        return (
            r.startsWith('sec-') ||
            r.startsWith('arch-') ||
            r.startsWith('circular') ||
            r.includes('injection') ||
            r.includes('secret') ||
            r.includes('leak')
        );
    }
}
