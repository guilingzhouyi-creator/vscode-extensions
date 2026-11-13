//! Module: taxis_cmd::daemon_scheduler — Scheduler Control Handle & Worker Spawn
//! File Path: src/bin/taxis_cmd/daemon_scheduler/scheduler_handle.rs
//! Architecture Role: Owns [`AsyncAuditScheduler`] channel sender, lifecycle atomic flags,
//!   trigger enqueue filtering, and `AuditStatus` projection for live IPC callers.
//! Dependencies & Triggers: Spawned by `daemon_persistent::run_persistent_daemon`.
//! Responsibilities: Ensure clean Drop shutdown and zero re-entrancy on audit/telemetry refs.
//! Exit Semantics & Design Rationale: Uses bounded `try_send` so IPC mutations never stall.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use fractal_git::server::IpcMessage;

use crate::taxis_cmd::daemon::daemon_runtime::DaemonHotSession;
use crate::taxis_cmd::daemon::daemon_transport::is_audit_paused;

use super::hydration::bootstrap_scheduler_telemetry;
use super::loop_batch::{run_scheduler_loop, SchedulerWorkerContext};
use super::ref_queries::is_self_owned_audit_or_telemetry_ref;
use super::{AuditTrigger, SchedulerConfig, SchedulerTelemetry, SCHEDULER_QUEUE_BOUND};

/// Handle controlling the persistent daemon background async audit worker thread.
pub struct AsyncAuditScheduler {
    git_dir: PathBuf,
    sender: SyncSender<AuditTrigger>,
    stop_flag: Arc<AtomicBool>,
    queued_jobs: Arc<AtomicUsize>,
    telemetry: Arc<Mutex<SchedulerTelemetry>>,
    worker: Option<JoinHandle<()>>,
}

impl AsyncAuditScheduler {
    /// Spawns the background async audit worker bound to `session` and returns its handle.
    #[must_use]
    pub fn spawn(
        git_dir: PathBuf,
        session: Arc<Mutex<DaemonHotSession>>,
        config: SchedulerConfig,
    ) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<AuditTrigger>(SCHEDULER_QUEUE_BOUND);
        let stop_flag = Arc::new(AtomicBool::new(false));
        let queued_jobs = Arc::new(AtomicUsize::new(0));
        let telemetry = Arc::new(Mutex::new(bootstrap_scheduler_telemetry(&git_dir)));

        let worker_ctx = SchedulerWorkerContext {
            git_dir: git_dir.clone(),
            session,
            stop_flag: Arc::clone(&stop_flag),
            queued_jobs: Arc::clone(&queued_jobs),
            telemetry: Arc::clone(&telemetry),
            config,
        };
        let worker = thread::spawn(move || {
            run_scheduler_loop(worker_ctx, receiver);
        });

        Self {
            git_dir,
            sender,
            stop_flag,
            queued_jobs,
            telemetry,
            worker: Some(worker),
        }
    }

    /// Enqueues a non-blocking audit trigger if the target ref does not belong to audit/telemetry.
    pub fn notify_trigger(&self, target_ref: Option<&str>, force: bool) -> bool {
        if let Some(ref_name) = target_ref {
            if is_self_owned_audit_or_telemetry_ref(ref_name) {
                return false;
            }
        }
        let trigger = AuditTrigger {
            target_ref: target_ref.map(str::to_owned),
            force,
        };
        if self.sender.try_send(trigger).is_ok() {
            self.queued_jobs.fetch_add(1, Ordering::Relaxed);
            return true;
        }
        false
    }

    /// Returns a live [`IpcMessage::AuditStatus`] snapshot for `QueryAuditStatus`.
    #[must_use]
    pub fn status_message(&self) -> IpcMessage {
        let paused = is_audit_paused(&self.git_dir);
        let queued = self.queued_jobs.load(Ordering::Relaxed);
        let guard = self.telemetry.lock().ok();
        let snap = guard.as_deref();
        IpcMessage::AuditStatus {
            active: !self.stop_flag.load(Ordering::Relaxed),
            paused,
            queued_jobs: queued,
            last_review_id: snap.and_then(|val| val.last_review_id.clone()),
            last_tree_oid: snap.and_then(|val| val.last_tree_oid.clone()),
            last_audit_commit_oid: snap.and_then(|val| val.last_audit_commit_oid.clone()),
            last_composite_score: snap.and_then(|val| val.last_composite_score),
            last_decision: snap.and_then(|val| val.last_decision.clone()),
            writes_audit_logs_dir: false,
        }
    }

    /// Signals shutdown and joins the background worker thread gracefully.
    pub fn shutdown(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for AsyncAuditScheduler {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}
