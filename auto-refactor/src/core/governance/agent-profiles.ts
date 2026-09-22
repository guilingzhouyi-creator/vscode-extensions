/**
 * Module: Governance Domain — Agent Security Profiles
 * File Path: src/core/governance/agent-profiles.ts
 * Architecture Role: Normative definitions of agent operational and governance profiles
 *   (C-07, Governance-Profile-Matrix, §3-1).
 * Dependencies & Triggers: Consumed by governance analyzers, report generation, and CLI.
 * Responsibilities:
 *   1. Define canonical agent execution profile enumeration.
 *   2. Provide profile type definitions for scan summaries.
 * Exit Semantics & Design Rationale: Pure enum and type definitions with zero side effects.
 */

/**
 * Agent security and governance execution profile.
 */
export enum AgentProfile {
    Untrusted = 'untrusted',
    Standard = 'standard',
    TrustedAutonomous = 'trusted-autonomous',
    HumanReview = 'human-review',
}

/**
 * Canonical agent execution profile name.
 */
export type AgentProfileName = `${AgentProfile}`;
