//! Module: taxis_cmd::daemon_scheduler — Worker Event Loop & Burst Coalescing
//! File Path: src/bin/taxis_cmd/daemon_scheduler/loop_batch.rs
//! Architecture Role: Consumes triggers on a bounded channel, coalesces burst mutations over
//!   the configured quiet window while preserving distinct ref identities, and runs idle polls.
//! Dependencies & Triggers: Spawned on a dedicated background thread by [`AsyncAuditScheduler`].
//! Responsibilities: Respect `.taxis/audit.paused` and clean shutdown flags without busy waiting.
//! Exit Semantics & Design Rationale: Bundles worker handles into [`SchedulerWorkerContext`].

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::taxis_cmd::daemon::daemon_runtime::DaemonHotSession;
use crate::taxis_cmd::daemon::daemon_transport::is_audit_paused;

use super::cycle::{dispatch_scheduled_cycle, CycleDispatchArgs};
use super::{AuditTrigger, SchedulerConfig, SchedulerTelemetry, SCHEDULER_QUEUE_BOUND};

pub(super) struct SchedulerWorkerContext {
    pub(super) git_dir: PathBuf,
    pub(super) session: Arc<Mutex<DaemonHotSession>>,
    pub(super) stop_flag: Arc<AtomicBool>,
    pub(super) queued_jobs: Arc<AtomicUsize>,
    pub(super) telemetry: Arc<Mutex<SchedulerTelemetry>>,
    pub(super) config: SchedulerConfig,
}

pub(super) fn run_scheduler_loop(
    ctx: SchedulerWorkerContext,
    receiver: mpsc::Receiver<AuditTrigger>,
) {
    let poll_interval = Duration::from_millis(ctx.config.heartbeat_ms.clamp(200, 300_000));
    let mut last_run_at = Instant::now() - poll_interval;

    while !ctx.stop_flag.load(Ordering::Relaxed) {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(trigger) => {
                ctx.queued_jobs.fetch_sub(1, Ordering::Relaxed);
                let batch = drain_burst_triggers(
                    &receiver,
                    trigger,
                    &ctx.queued_jobs,
                    ctx.config.quiet_ms,
                );
                for entry in &batch {
                    if ctx.stop_flag.load(Ordering::Relaxed) || is_audit_paused(&ctx.git_dir) {
                        break;
                    }
                    let _ = dispatch_scheduled_cycle(&CycleDispatchArgs {
                        git_dir: &ctx.git_dir,
                        session: &ctx.session,
                        telemetry: &ctx.telemetry,
                        source_ref: entry.target_ref.as_deref(),
                        archetype: ctx.config.archetype,
                        force: entry.force,
                    });
                    last_run_at = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !is_audit_paused(&ctx.git_dir) && last_run_at.elapsed() >= poll_interval {
                    let _ = dispatch_scheduled_cycle(&CycleDispatchArgs {
                        git_dir: &ctx.git_dir,
                        session: &ctx.session,
                        telemetry: &ctx.telemetry,
                        source_ref: None,
                        archetype: ctx.config.archetype,
                        force: false,
                    });
                    last_run_at = Instant::now();
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn merge_burst_trigger(batch: &mut Vec<AuditTrigger>, incoming: AuditTrigger) {
    if let Some(existing) = batch
        .iter_mut()
        .find(|entry| entry.target_ref == incoming.target_ref)
    {
        existing.force |= incoming.force;
        return;
    }
    if batch.len() < SCHEDULER_QUEUE_BOUND {
        batch.push(incoming);
    }
}

pub(super) fn drain_burst_triggers(
    receiver: &mpsc::Receiver<AuditTrigger>,
    first: AuditTrigger,
    queued_jobs: &Arc<AtomicUsize>,
    quiet_ms: u64,
) -> Vec<AuditTrigger> {
    let mut force_immediate = first.force;
    let mut batch = Vec::with_capacity(4);
    batch.push(first);
    let deadline = Instant::now() + Duration::from_millis(quiet_ms.min(2000));
    loop {
        let next_msg = if force_immediate {
            receiver.try_recv().ok()
        } else {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            receiver
                .recv_timeout(remaining.min(Duration::from_millis(40)))
                .ok()
        };
        let Some(next_trigger) = next_msg else {
            break;
        };
        queued_jobs.fetch_sub(1, Ordering::Relaxed);
        force_immediate |= next_trigger.force;
        merge_burst_trigger(&mut batch, next_trigger);
    }
    batch
}
