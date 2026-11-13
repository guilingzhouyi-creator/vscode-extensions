//! Module: taxis_cmd::daemon_persistent — Persistent Daemon Lifecycle & Listener Loop
//! File Path: src/bin/taxis_cmd/daemon_persistent.rs
//! Architecture Role: Starts the background async audit scheduler alongside the Token-TCP /
//!   Unix UDS IPC server loop, enforces single-instance liveness, and handles `taxis daemon stop`.
//! Dependencies & Triggers: Dispatched by `taxis daemon {start, stop}` and `--persistent`.
//! Responsibilities: Clean stale orphaned files on startup, serve IPC frames, and drain scheduler.
//! Exit Semantics & Design Rationale: Stops cleanly when `.taxis/daemon.stop`, max-requests, or
//!   max-lifetime thresholds are reached.

use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fractal_git::constants::cli::CliTag;

use super::super::common::{fail_io, find_arg_value, print_json, reject, CliContext};
use super::daemon_ipc_dispatch::{handle_persistent_stream, PersistentStreamContext};
use super::daemon_runtime::DaemonHotSession;
use super::daemon_scheduler::{parse_archetype_flag, AsyncAuditScheduler, SchedulerConfig};
use super::daemon_transport::{
    bind_persistent_listener, cleanup_stale_daemon_files, is_stop_requested, probe_daemon_alive,
    resolve_taxis_runtime_dir, write_daemon_meta_atomic, PlatformListener, DAEMON_STOP_FILENAME,
};

pub(super) fn handle_daemon_stop(ctx: &CliContext) {
    let runtime_dir = resolve_taxis_runtime_dir(&ctx.git_dir);
    if let Err(err) = std::fs::create_dir_all(&runtime_dir) {
        fail_io("create taxis runtime directory for stop signal", err);
    }
    let stop_path = runtime_dir.join(DAEMON_STOP_FILENAME);
    if let Err(err) = std::fs::write(&stop_path, b"stop\n") {
        fail_io("write daemon stop sentinel", err);
    }
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "stop_requested": true,
            "stop_file": stop_path.to_string_lossy(),
        }));
    } else {
        println!("[taxis daemon] stop signal written");
    }
}

pub(super) fn run_persistent_daemon(ctx: &CliContext) {
    if let Some(existing) = probe_daemon_alive(&ctx.git_dir) {
        if existing.pid != std::process::id() {
            reject(
                CliTag::ERROR,
                format!(
                    "active Taxis daemon already running (pid={} endpoint={})",
                    existing.pid, existing.endpoint
                ),
            );
        }
    } else {
        cleanup_stale_daemon_files(&ctx.git_dir);
    }

    let explicit_addr = find_arg_value(&ctx.args, &["--addr"]);
    let (listener, meta) = bind_persistent_listener(&ctx.git_dir, explicit_addr)
        .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()));
    let _discovery_guard = write_daemon_meta_atomic(&ctx.git_dir, &meta)
        .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()));

    let session = Arc::new(Mutex::new(DaemonHotSession::open(&ctx.git_dir)));
    let scheduler = AsyncAuditScheduler::spawn(
        ctx.git_dir.clone(),
        Arc::clone(&session),
        parse_scheduler_config(&ctx.args),
    );

    if ctx.json_mode {
        print_json(&meta);
    } else {
        println!(
            "[taxis daemon] persistent async audit active ({} @ {})",
            meta.transport, meta.endpoint
        );
    }
    let _ = std::io::stdout().flush();

    let max_requests =
        find_arg_value(&ctx.args, &["--max-requests"]).and_then(|val| val.parse::<usize>().ok());
    let max_lifetime_ms =
        find_arg_value(&ctx.args, &["--max-lifetime-ms"]).and_then(|val| val.parse::<u64>().ok());
    let started = Instant::now();
    let mut handled = 0usize;
    let stream_ctx = PersistentStreamContext {
        git_dir: &ctx.git_dir,
        token_hex: &meta.token_hex,
        session: &session,
        scheduler: &scheduler,
    };

    loop {
        if is_stop_requested(&ctx.git_dir) {
            break;
        }
        if max_requests.is_some_and(|limit| handled >= limit) {
            break;
        }
        if max_lifetime_ms.is_some_and(|ms| started.elapsed() >= Duration::from_millis(ms)) {
            break;
        }
        if accept_next_connection(&listener, &stream_ctx) {
            handled += 1;
        } else {
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    scheduler.shutdown();
}

fn parse_scheduler_config(args: &[String]) -> SchedulerConfig {
    let quiet_ms = find_arg_value(args, &["--quiet-ms"])
        .and_then(|val| val.parse::<u64>().ok())
        .unwrap_or(400);
    let heartbeat_ms = find_arg_value(args, &["--heartbeat-ms"])
        .and_then(|val| val.parse::<u64>().ok())
        .unwrap_or(60_000);
    let archetype = parse_archetype_flag(args);
    SchedulerConfig {
        quiet_ms,
        heartbeat_ms,
        archetype,
    }
}

fn accept_next_connection(listener: &PlatformListener, ctx: &PersistentStreamContext<'_>) -> bool {
    match listener {
        PlatformListener::Tcp(tcp_listener) => match tcp_listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
                handle_persistent_stream(&mut stream, true, ctx);
                true
            }
            Err(_) => false,
        },
        #[cfg(unix)]
        PlatformListener::Unix(unix_listener) => match unix_listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
                handle_persistent_stream(&mut stream, false, ctx);
                true
            }
            Err(_) => false,
        },
    }
}
