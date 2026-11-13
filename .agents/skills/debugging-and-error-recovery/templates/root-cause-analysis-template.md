# Root Cause Analysis Record

## 1. Incident Summary
- **Defect ID**: `[ID]`
- **Trigger Input**: Minimal reproducible sequence and environment.
- **Observed Behavior**: Actual error trace, state corruption, or exit status.
- **Expected Behavior**: Contracted invariant or deterministic output.

## 2. Root Cause Diagnosis
- **Fault Location**: `path/to/file.ts:line`
- **Mechanism**: Exact root cause (race condition / swallowed catch / bounds overflow).

## 3. Minimal Fix & Regression Proof
- **Fix Strategy**: Smallest structural fix preserving module invariants.
- **Regression Spec**: Path to the newly locked deterministic unit test.
