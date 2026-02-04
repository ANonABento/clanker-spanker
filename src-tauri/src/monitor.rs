use crate::db::AppState;
use crate::dock;
use crate::tray;
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use uuid::Uuid;

/// Event payload for monitor state changes
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorStatePayload {
    pub active_count: i32,
}

/// Get count of active monitors (running or sleeping)
pub fn get_active_monitor_count(state: &AppState) -> Result<i32, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM monitors WHERE status IN ('running', 'sleeping')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count monitors: {}", e))?;

    Ok(count)
}

/// Emit monitor state changed event and update tray/dock
fn emit_state_change<R: tauri::Runtime>(app: &tauri::AppHandle<R>, state: &AppState) {
    if let Ok(count) = get_active_monitor_count(state) {
        // Update tray tooltip
        tray::update_tray_status(count);

        // Update dock badge (macOS only)
        dock::set_dock_badge(if count > 0 { Some(count) } else { None });

        // Emit event for frontend
        let _ = app.emit(
            "monitor:state-changed",
            MonitorStatePayload {
                active_count: count,
            },
        );
    }
}

/// Monitor status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MonitorStatus {
    Running,
    Sleeping,
    Completed,
    Failed,
    Stopped,
}

impl MonitorStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            MonitorStatus::Running => "running",
            MonitorStatus::Sleeping => "sleeping",
            MonitorStatus::Completed => "completed",
            MonitorStatus::Failed => "failed",
            MonitorStatus::Stopped => "stopped",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => MonitorStatus::Running,
            "sleeping" => MonitorStatus::Sleeping,
            "completed" => MonitorStatus::Completed,
            "failed" => MonitorStatus::Failed,
            "stopped" => MonitorStatus::Stopped,
            _ => MonitorStatus::Running,
        }
    }
}

/// Monitor data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    pub id: String,
    pub pr_id: String,
    pub pr_number: i32,
    pub repo: String,
    pub pid: Option<i32>,
    pub status: String,
    pub iteration: i32,
    pub max_iterations: i32,
    pub interval_minutes: i32,
    pub started_at: String,
    pub last_check_at: Option<String>,
    pub next_check_at: Option<String>,
    pub ended_at: Option<String>,
    pub comments_fixed: i32,
    pub exit_reason: Option<String>,
    pub log_file: String,
}

/// Start monitoring a PR
#[tauri::command]
pub fn start_monitor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    pr_id: String,
    pr_number: i32,
    repo: String,
    max_iterations: Option<i32>,
    interval_minutes: Option<i32>,
) -> Result<Monitor, String> {
    let id = Uuid::new_v4().to_string();
    let max_iter = max_iterations.unwrap_or(10);
    let interval = interval_minutes.unwrap_or(15); // Default to 15 minutes
    let now: DateTime<Utc> = Utc::now();
    let started_at = now.to_rfc3339();
    let next_check = (now + Duration::minutes(interval as i64)).to_rfc3339();

    // Create log file path
    let log_dir = dirs::data_local_dir()
        .ok_or_else(|| "Failed to get local data directory".to_string())?
        .join("com.clanker-spanker.app")
        .join("logs");

    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory: {}", e))?;

    let log_file = log_dir
        .join(format!("monitor-{}-{}.log", pr_number, &id))
        .to_string_lossy()
        .to_string();

    // Database operations in a block to release lock early
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        // Check if there's already an active monitor for this PR
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM monitors WHERE pr_id = ?1 AND status IN ('running', 'sleeping')",
                [&pr_id],
                |row| row.get(0),
            )
            .ok();

        if existing.is_some() {
            return Err(format!("Monitor already running for PR: {}", pr_id));
        }

        conn.execute(
            r#"
            INSERT INTO monitors (
                id, pr_id, pr_number, repo, status, iteration, max_iterations,
                interval_minutes, started_at, next_check_at, log_file
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                id,
                pr_id,
                pr_number,
                repo,
                "running",
                0,
                max_iter,
                interval,
                started_at,
                next_check,
                log_file
            ],
        )
        .map_err(|e| format!("Failed to create monitor: {}", e))?;
    }

    // Spawn the monitor process
    let pid = state.processes.spawn_monitor(
        &app,
        &id,
        &pr_id,
        pr_number,
        &repo,
        max_iter,
        interval,
    )?;

    // Update the PID in the database
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        conn.execute(
            "UPDATE monitors SET pid = ?1 WHERE id = ?2",
            params![pid as i32, id],
        )
        .map_err(|e| format!("Failed to update monitor PID: {}", e))?;
    }

    // Emit state change event and update tray
    emit_state_change(&app, &state);

    Ok(Monitor {
        id,
        pr_id,
        pr_number,
        repo,
        pid: Some(pid as i32),
        status: "running".to_string(),
        iteration: 0,
        max_iterations: max_iter,
        interval_minutes: interval,
        started_at,
        last_check_at: None,
        next_check_at: Some(next_check),
        ended_at: None,
        comments_fixed: 0,
        exit_reason: None,
        log_file,
    })
}

/// Stop a running monitor
#[tauri::command]
pub fn stop_monitor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    monitor_id: String,
) -> Result<Monitor, String> {
    // Kill the process first
    if let Err(e) = state.processes.kill(&monitor_id) {
        eprintln!("Warning: Failed to kill monitor process: {}", e);
    }

    // Update database
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            UPDATE monitors
            SET status = 'stopped', ended_at = ?1, exit_reason = 'user_stopped'
            WHERE id = ?2 AND status IN ('running', 'sleeping')
            "#,
            params![now, monitor_id],
        )
        .map_err(|e| format!("Failed to stop monitor: {}", e))?;
    }

    // Emit state change event and update tray
    emit_state_change(&app, &state);

    get_monitor(state, monitor_id)
}

/// Get all monitors, optionally filtered by status or repo
#[tauri::command]
pub fn get_monitors(
    state: State<'_, AppState>,
    status: Option<String>,
    repo: Option<String>,
) -> Result<Vec<Monitor>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let mut query = String::from(
        r#"
        SELECT id, pr_id, pr_number, repo, pid, status, iteration, max_iterations,
               interval_minutes, started_at, last_check_at, next_check_at, ended_at,
               comments_fixed, exit_reason, log_file
        FROM monitors
        WHERE 1=1
        "#,
    );

    let mut params: Vec<String> = vec![];

    if let Some(s) = &status {
        if s != "all" {
            query.push_str(" AND status = ?");
            params.push(s.clone());
        }
    }

    if let Some(r) = &repo {
        query.push_str(&format!(" AND repo = ?{}", params.len() + 1));
        params.push(r.clone());
    }

    query.push_str(" ORDER BY started_at DESC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let params_refs: Vec<&dyn rusqlite::ToSql> =
        params.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

    let monitors = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(Monitor {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                pr_number: row.get(2)?,
                repo: row.get(3)?,
                pid: row.get(4)?,
                status: row.get(5)?,
                iteration: row.get(6)?,
                max_iterations: row.get(7)?,
                interval_minutes: row.get(8)?,
                started_at: row.get(9)?,
                last_check_at: row.get(10)?,
                next_check_at: row.get(11)?,
                ended_at: row.get(12)?,
                comments_fixed: row.get(13)?,
                exit_reason: row.get(14)?,
                log_file: row.get(15)?,
            })
        })
        .map_err(|e| format!("Failed to query monitors: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read monitor: {}", e))?;

    Ok(monitors)
}

/// Get a single monitor by ID
#[tauri::command]
pub fn get_monitor(state: State<'_, AppState>, monitor_id: String) -> Result<Monitor, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    conn.query_row(
        r#"
        SELECT id, pr_id, pr_number, repo, pid, status, iteration, max_iterations,
               interval_minutes, started_at, last_check_at, next_check_at, ended_at,
               comments_fixed, exit_reason, log_file
        FROM monitors WHERE id = ?1
        "#,
        [&monitor_id],
        |row| {
            Ok(Monitor {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                pr_number: row.get(2)?,
                repo: row.get(3)?,
                pid: row.get(4)?,
                status: row.get(5)?,
                iteration: row.get(6)?,
                max_iterations: row.get(7)?,
                interval_minutes: row.get(8)?,
                started_at: row.get(9)?,
                last_check_at: row.get(10)?,
                next_check_at: row.get(11)?,
                ended_at: row.get(12)?,
                comments_fixed: row.get(13)?,
                exit_reason: row.get(14)?,
                log_file: row.get(15)?,
            })
        },
    )
    .map_err(|e| format!("Monitor not found: {}", e))
}

/// Get active monitor for a specific PR (if any)
#[tauri::command]
pub fn get_monitor_for_pr(
    state: State<'_, AppState>,
    pr_id: String,
) -> Result<Option<Monitor>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let result = conn.query_row(
        r#"
        SELECT id, pr_id, pr_number, repo, pid, status, iteration, max_iterations,
               interval_minutes, started_at, last_check_at, next_check_at, ended_at,
               comments_fixed, exit_reason, log_file
        FROM monitors
        WHERE pr_id = ?1 AND status IN ('running', 'sleeping')
        ORDER BY started_at DESC
        LIMIT 1
        "#,
        [&pr_id],
        |row| {
            Ok(Monitor {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                pr_number: row.get(2)?,
                repo: row.get(3)?,
                pid: row.get(4)?,
                status: row.get(5)?,
                iteration: row.get(6)?,
                max_iterations: row.get(7)?,
                interval_minutes: row.get(8)?,
                started_at: row.get(9)?,
                last_check_at: row.get(10)?,
                next_check_at: row.get(11)?,
                ended_at: row.get(12)?,
                comments_fixed: row.get(13)?,
                exit_reason: row.get(14)?,
                log_file: row.get(15)?,
            })
        },
    );

    match result {
        Ok(monitor) => Ok(Some(monitor)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Database error: {}", e)),
    }
}

/// Update monitor iteration (internal use)
pub fn update_monitor_iteration(
    state: &State<'_, AppState>,
    monitor_id: &str,
    iteration: i32,
    comments_fixed: i32,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let now = Utc::now().to_rfc3339();

    conn.execute(
        r#"
        UPDATE monitors
        SET iteration = ?1, last_check_at = ?2, comments_fixed = comments_fixed + ?3
        WHERE id = ?4
        "#,
        params![iteration, now, comments_fixed, monitor_id],
    )
    .map_err(|e| format!("Failed to update monitor: {}", e))?;

    Ok(())
}

/// Mark monitor as completed
pub fn complete_monitor(
    state: &State<'_, AppState>,
    monitor_id: &str,
    exit_reason: &str,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let now = Utc::now().to_rfc3339();

    conn.execute(
        r#"
        UPDATE monitors
        SET status = 'completed', ended_at = ?1, exit_reason = ?2
        WHERE id = ?3
        "#,
        params![now, exit_reason, monitor_id],
    )
    .map_err(|e| format!("Failed to complete monitor: {}", e))?;

    Ok(())
}

/// Mark monitor as failed
pub fn fail_monitor(
    state: &State<'_, AppState>,
    monitor_id: &str,
    error: &str,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let now = Utc::now().to_rfc3339();

    conn.execute(
        r#"
        UPDATE monitors
        SET status = 'failed', ended_at = ?1, exit_reason = ?2
        WHERE id = ?3
        "#,
        params![now, format!("error:{}", error), monitor_id],
    )
    .map_err(|e| format!("Failed to fail monitor: {}", e))?;

    Ok(())
}

/// PR Comment data structure (from review threads)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRComment {
    pub id: String,
    pub thread_id: String,
    pub pr_id: String,
    pub comment_type: String,
    pub is_resolved: bool,
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

/// GitHub review thread structure
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubReviewThread {
    id: String,
    is_resolved: bool,
    comments: Vec<GitHubThreadComment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubThreadComment {
    id: String,
    author: Option<GitHubAuthor>,
    body: String,
    path: Option<String>,
    #[serde(default)]
    line: Option<i32>,
    created_at: String,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubAuthor {
    login: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubReviewThreadsResponse {
    review_threads: Vec<GitHubReviewThread>,
}

/// Fetch all review thread comments for a PR and store in database
#[tauri::command]
pub fn fetch_pr_comments(
    state: State<'_, AppState>,
    pr_number: i32,
    repo: String,
) -> Result<Vec<PRComment>, String> {
    use std::process::Command;

    let pr_id = format!("{}#{}", repo, pr_number);

    // Fetch review threads from GitHub
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--repo",
            &repo,
            "--json",
            "reviewThreads",
        ])
        .output()
        .map_err(|e| format!("Failed to execute gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh CLI error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let response: GitHubReviewThreadsResponse =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let now = Utc::now().to_rfc3339();

    // Convert to PRComment and store in database
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    // Clear old comments for this PR
    conn.execute("DELETE FROM pr_comments WHERE pr_id = ?1", [&pr_id])
        .map_err(|e| format!("Failed to clear old comments: {}", e))?;

    let mut comments: Vec<PRComment> = Vec::new();

    for thread in response.review_threads {
        // Get the first comment in the thread (the main comment)
        if let Some(first_comment) = thread.comments.first() {
            let comment = PRComment {
                id: first_comment.id.clone(),
                thread_id: thread.id.clone(),
                pr_id: pr_id.clone(),
                comment_type: "review_thread".to_string(),
                is_resolved: thread.is_resolved,
                author: first_comment
                    .author
                    .as_ref()
                    .map(|a| a.login.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                body: first_comment.body.clone(),
                path: first_comment.path.clone(),
                line: first_comment.line,
                created_at: first_comment.created_at.clone(),
                updated_at: first_comment
                    .updated_at
                    .clone()
                    .unwrap_or_else(|| first_comment.created_at.clone()),
            };

            // Store in database
            conn.execute(
                r#"
                INSERT INTO pr_comments (
                    id, pr_id, thread_id, comment_type, is_resolved, author,
                    body, path, line, created_at, updated_at, fetched_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(id) DO UPDATE SET
                    is_resolved = excluded.is_resolved,
                    body = excluded.body,
                    updated_at = excluded.updated_at,
                    fetched_at = excluded.fetched_at
                "#,
                params![
                    comment.id,
                    comment.pr_id,
                    comment.thread_id,
                    comment.comment_type,
                    comment.is_resolved as i32,
                    comment.author,
                    comment.body,
                    comment.path,
                    comment.line,
                    comment.created_at,
                    comment.updated_at,
                    now
                ],
            )
            .map_err(|e| format!("Failed to insert comment: {}", e))?;

            comments.push(comment);
        }
    }

    // Update unresolved_threads count in pr_cache
    let unresolved_count = comments.iter().filter(|c| !c.is_resolved).count() as i32;
    conn.execute(
        "UPDATE pr_cache SET unresolved_threads = ?1 WHERE id = ?2",
        params![unresolved_count, pr_id],
    )
    .ok(); // Ignore if PR not in cache

    Ok(comments)
}

/// Get cached comments for a PR (without fetching from GitHub)
#[tauri::command]
pub fn get_pr_comments(
    state: State<'_, AppState>,
    pr_id: String,
    unresolved_only: Option<bool>,
) -> Result<Vec<PRComment>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let query = if unresolved_only.unwrap_or(false) {
        "SELECT id, thread_id, pr_id, comment_type, is_resolved, author, body, path, line, created_at, updated_at FROM pr_comments WHERE pr_id = ?1 AND is_resolved = 0"
    } else {
        "SELECT id, thread_id, pr_id, comment_type, is_resolved, author, body, path, line, created_at, updated_at FROM pr_comments WHERE pr_id = ?1"
    };

    let mut stmt = conn
        .prepare(query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let comments = stmt
        .query_map([&pr_id], |row| {
            Ok(PRComment {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                pr_id: row.get(2)?,
                comment_type: row.get(3)?,
                is_resolved: row.get::<_, i32>(4)? != 0,
                author: row.get(5)?,
                body: row.get(6)?,
                path: row.get(7)?,
                line: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("Query failed: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read rows: {}", e))?;

    Ok(comments)
}
