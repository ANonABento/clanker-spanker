use crate::api;
use crate::db::{self, AppState};
use crate::global_settings;
use crate::monitor;
use chrono::{Datelike, Local, NaiveTime, TimeZone};
use rusqlite::params;
use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri::{AppHandle, Runtime};
use uuid::Uuid;

const SCHEDULE_LAST_RUN_KEY: &str = "last_schedule_run_at";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub status: String,
    pub total_jobs: i32,
    pub completed_jobs: i32,
    pub failed_jobs: i32,
    pub queued_jobs: i32,
    pub running_jobs: i32,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone)]
struct JobRow {
    id: String,
    run_id: String,
    pr_id: String,
    pr_number: i32,
    repo: String,
}

pub fn start_orchestrator<R: Runtime + 'static>(app: AppHandle<R>) {
    thread::spawn(move || loop {
        if let Some(state) = app.try_state::<AppState>() {
            if let Err(e) = maybe_trigger_schedule(&app, &state) {
                eprintln!("Scheduler error: {}", e);
            }
            if let Err(e) = dispatch_jobs(&app, &state) {
                eprintln!("Dispatch error: {}", e);
            }
        }
        thread::sleep(Duration::from_secs(30));
    });
}

#[tauri::command]
pub fn start_overnight_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<RunSummary, String> {
    let run_id = enqueue_run(&app, &state)?;
    get_run_summary(&state, &run_id)
}

#[tauri::command]
pub fn get_active_runs(state: tauri::State<'_, AppState>) -> Result<Vec<RunSummary>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, status, total_jobs, completed_jobs, failed_jobs, queued_jobs, running_jobs, started_at, ended_at
            FROM job_runs
            WHERE status = 'running'
            ORDER BY started_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let runs = stmt
        .query_map([], |row| {
            Ok(RunSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                total_jobs: row.get(2)?,
                completed_jobs: row.get(3)?,
                failed_jobs: row.get(4)?,
                queued_jobs: row.get(5)?,
                running_jobs: row.get(6)?,
                started_at: row.get(7)?,
                ended_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to query runs: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read runs: {}", e))?;

    Ok(runs)
}

fn maybe_trigger_schedule<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let settings = global_settings::ensure_global_settings(&conn)?;
    if !settings.schedule.enabled {
        return Ok(());
    }

    let today = Local::now().date_naive();
    let weekday = today.weekday().to_string().to_lowercase();
    if !settings.schedule.days.iter().any(|d| d == &weekday[0..3]) {
        return Ok(());
    }

    let schedule_time = parse_time(&settings.schedule.time)?;
    let scheduled_at = Local
        .from_local_datetime(&today.and_time(schedule_time))
        .single()
        .ok_or_else(|| "Failed to resolve schedule time".to_string())?;

    let last_run_at = db::get_setting(&conn, SCHEDULE_LAST_RUN_KEY)
        .map_err(|e| format!("Database error: {}", e))?
        .and_then(|ts| chrono::DateTime::parse_from_rfc3339(&ts).ok())
        .map(|dt| dt.with_timezone(&Local));

    let now = Local::now();
    if now < scheduled_at {
        return Ok(());
    }

    if let Some(last_run) = last_run_at {
        if last_run >= scheduled_at {
            return Ok(());
        }
    }

    if has_active_run(&conn)? {
        return Ok(());
    }

    drop(conn);
    let _ = enqueue_run(app, state)?;

    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;
    db::set_setting(&conn, SCHEDULE_LAST_RUN_KEY, &now.to_rfc3339())
        .map_err(|e| format!("Database error: {}", e))?;

    Ok(())
}

fn has_active_run(conn: &rusqlite::Connection) -> Result<bool, String> {
    let exists: i32 = conn
        .query_row("SELECT COUNT(*) FROM job_runs WHERE status = 'running'", [], |row| {
            row.get(0)
        })
        .map_err(|e| format!("Failed to query job runs: {}", e))?;
    Ok(exists > 0)
}

fn enqueue_run<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<String, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let settings = global_settings::ensure_global_settings(&conn)?;
    let max_jobs = settings.max_jobs_per_night.max(1);
    let run_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO job_runs (id, status, total_jobs, queued_jobs, running_jobs, completed_jobs, failed_jobs, started_at) VALUES (?1, 'running', 0, 0, 0, 0, 0, datetime('now'))",
        params![run_id],
    )
    .map_err(|e| format!("Failed to create run: {}", e))?;

    let rows = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, number, repo, unresolved_threads
                FROM pr_cache
                WHERE state = 'open' AND is_draft = 0
                ORDER BY unresolved_threads DESC, updated_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let result = stmt
            .query_map([max_jobs], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query PRs: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read PR rows: {}", e))?;
        result
    };

    let mut queued = 0;
    for row in rows {
        let (pr_id, pr_number, repo, unresolved_threads) = row;

        let already_queued: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM job_queue WHERE pr_id = ?1 AND status IN ('queued','running')",
                [&pr_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if already_queued > 0 {
            continue;
        }

        let monitor_active: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM monitors WHERE pr_id = ?1 AND status IN ('running','sleeping')",
                [&pr_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if monitor_active > 0 {
            continue;
        }

        let job_id = Uuid::new_v4().to_string();
        conn.execute(
            r#"
            INSERT INTO job_queue (id, run_id, pr_id, pr_number, repo, status, priority)
            VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6)
            "#,
            params![job_id, run_id, pr_id, pr_number, repo, unresolved_threads],
        )
        .map_err(|e| format!("Failed to enqueue job: {}", e))?;
        queued += 1;
    }

    conn.execute(
        "UPDATE job_runs SET total_jobs = ?1, queued_jobs = ?2 WHERE id = ?3",
        params![queued, queued, run_id],
    )
    .map_err(|e| format!("Failed to update run totals: {}", e))?;

    drop(conn);
    dispatch_jobs(app, state)?;

    Ok(run_id)
}

fn dispatch_jobs<R: Runtime>(app: &AppHandle<R>, state: &AppState) -> Result<(), String> {
    let active_count = monitor::get_active_monitor_count(state).unwrap_or(0);
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;
    let settings = global_settings::ensure_global_settings(&conn)?;
    let available_slots = (settings.concurrency_cap - active_count).max(0) as usize;
    if available_slots == 0 {
        return Ok(());
    }

    let jobs = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, run_id, pr_id, pr_number, repo
                FROM job_queue
                WHERE status = 'queued'
                ORDER BY priority DESC, created_at ASC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let result = stmt
            .query_map([available_slots as i64], |row| {
                Ok(JobRow {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    pr_id: row.get(2)?,
                    pr_number: row.get(3)?,
                    repo: row.get(4)?,
                })
            })
            .map_err(|e| format!("Failed to query jobs: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read jobs: {}", e))?;
        result
    };

    drop(conn);

    for job in jobs {
        let monitor = api::start_monitor_internal(
            app,
            state,
            job.pr_id.clone(),
            job.pr_number,
            job.repo.clone(),
            None,
            None,
        );

        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        match monitor {
            Ok(monitor) => {
                conn.execute(
                    r#"
                    UPDATE job_queue
                    SET status = 'running', started_at = datetime('now'), monitor_id = ?1
                    WHERE id = ?2
                    "#,
                    params![monitor.id, job.id],
                )
                .map_err(|e| format!("Failed to update job: {}", e))?;
            }
            Err(err) => {
                conn.execute(
                    r#"
                    UPDATE job_queue
                    SET status = 'failed', ended_at = datetime('now'), error_message = ?1
                    WHERE id = ?2
                    "#,
                    params![err, job.id],
                )
                .map_err(|e| format!("Failed to update job: {}", e))?;
            }
        }
    }

    Ok(())
}

fn parse_time(value: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| "Schedule time must be HH:MM".to_string())
}

pub fn update_job_status(
    conn: &rusqlite::Connection,
    monitor_id: &str,
    status: &str,
    exit_reason: &str,
) {
    let run_id: Option<String> = conn
        .query_row(
            "SELECT run_id FROM job_queue WHERE monitor_id = ?1",
            [monitor_id],
            |row| row.get(0),
        )
        .ok();

    let Some(run_id) = run_id else { return };

    let _ = conn.execute(
        "UPDATE job_queue SET status = ?1, ended_at = datetime('now'), error_message = ?2 WHERE monitor_id = ?3",
        params![status, exit_reason, monitor_id],
    );

    let counts = conn
        .query_row(
            r#"
            SELECT
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
            FROM job_queue
            WHERE run_id = ?1
            "#,
            [&run_id],
            |row| {
                Ok((
                    row.get::<_, i32>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            },
        )
        .ok();

    if let Some((queued, running, completed, failed)) = counts {
        let _ = conn.execute(
            r#"
            UPDATE job_runs
            SET queued_jobs = ?1, running_jobs = ?2, completed_jobs = ?3, failed_jobs = ?4
            WHERE id = ?5
            "#,
            params![queued, running, completed, failed, run_id],
        );

        if queued == 0 && running == 0 {
            let final_status = if failed > 0 { "failed" } else { "completed" };
            let _ = conn.execute(
                "UPDATE job_runs SET status = ?1, ended_at = datetime('now') WHERE id = ?2",
                params![final_status, run_id],
            );
        }
    }
}

fn get_run_summary(
    state: &AppState,
    run_id: &str,
) -> Result<RunSummary, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    conn.query_row(
        r#"
        SELECT id, status, total_jobs, completed_jobs, failed_jobs, queued_jobs, running_jobs, started_at, ended_at
        FROM job_runs WHERE id = ?1
        "#,
        [run_id],
        |row| {
            Ok(RunSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                total_jobs: row.get(2)?,
                completed_jobs: row.get(3)?,
                failed_jobs: row.get(4)?,
                queued_jobs: row.get(5)?,
                running_jobs: row.get(6)?,
                started_at: row.get(7)?,
                ended_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| format!("Run not found: {}", e))
}
