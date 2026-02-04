//! HTTP API for external integrations (e.g., Claude Code /monitor-pr command)
//!
//! Listens on port 7890 and provides endpoints to start/stop monitors.

use crate::db::AppState;
use crate::monitor;
use serde::{Deserialize, Serialize};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tiny_http::{Header, Method, Response, Server};

const API_PORT: u16 = 7890;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartMonitorRequest {
    pr_number: i32,
    repo: String,
    max_iterations: Option<i32>,
    interval_minutes: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> String {
        serde_json::to_string(&ApiResponse {
            success: true,
            data: Some(data),
            error: None,
        })
        .unwrap_or_else(|_| r#"{"success":false,"error":"Serialization error"}"#.to_string())
    }

    fn error(msg: &str) -> String {
        serde_json::to_string(&ApiResponse::<()> {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        })
        .unwrap_or_else(|_| r#"{"success":false,"error":"Serialization error"}"#.to_string())
    }
}

/// Start the HTTP API server in a background thread
pub fn start_api_server<R: Runtime + 'static>(app: AppHandle<R>) {
    thread::spawn(move || {
        let server = match Server::http(format!("127.0.0.1:{}", API_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to start API server on port {}: {}", API_PORT, e);
                return;
            }
        };

        println!("Clanker Spanker API listening on http://127.0.0.1:{}", API_PORT);

        for mut request in server.incoming_requests() {
            let response = handle_request(&app, &mut request);
            let _ = request.respond(response);
        }
    });
}

fn handle_request<R: Runtime>(
    app: &AppHandle<R>,
    request: &mut tiny_http::Request,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let path = request.url().to_string();
    let method = request.method().clone();

    // CORS headers
    let cors_headers = vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..])
            .unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
    ];

    // Handle CORS preflight
    if method == Method::Options {
        let mut response = Response::from_string("").with_status_code(204);
        for header in cors_headers {
            response = response.with_header(header);
        }
        return response;
    }

    let (status, body) = match (method, path.as_str()) {
        // Health check
        (Method::Get, "/api/health") => (200, r#"{"status":"ok"}"#.to_string()),

        // Start monitor
        (Method::Post, "/api/monitor/start") => {
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                (400, ApiResponse::<()>::error("Failed to read request body"))
            } else {
                match serde_json::from_str::<StartMonitorRequest>(&body) {
                    Ok(req) => handle_start_monitor(app, req),
                    Err(e) => (400, ApiResponse::<()>::error(&format!("Invalid JSON: {}", e))),
                }
            }
        }

        // Stop monitor by PR ID
        (Method::Post, path) if path.starts_with("/api/monitor/stop/") => {
            let pr_id = path.trim_start_matches("/api/monitor/stop/");
            handle_stop_monitor(app, pr_id)
        }

        // Get monitor status by PR ID
        (Method::Get, path) if path.starts_with("/api/monitor/status/") => {
            let pr_id = path.trim_start_matches("/api/monitor/status/");
            handle_get_monitor(app, pr_id)
        }

        // List all monitors
        (Method::Get, "/api/monitors") => handle_list_monitors(app),

        // 404
        _ => (404, ApiResponse::<()>::error("Not found")),
    };

    let mut response =
        Response::from_string(body).with_status_code(status as u16);
    for header in cors_headers {
        response = response.with_header(header);
    }
    response
}

fn handle_start_monitor<R: Runtime>(
    app: &AppHandle<R>,
    req: StartMonitorRequest,
) -> (i32, String) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return (500, ApiResponse::<()>::error("App state not available")),
    };

    let pr_id = format!("{}#{}", req.repo, req.pr_number);

    // Fetch and cache PR metadata so it shows up in the dashboard
    if let Err(e) = fetch_and_cache_pr(&state, req.pr_number, &req.repo) {
        eprintln!("Warning: Failed to cache PR: {}", e);
        // Continue anyway - monitor can still work
    }

    // Use the monitor module's start_monitor logic
    match start_monitor_internal(
        app,
        &state,
        pr_id.clone(),
        req.pr_number,
        req.repo.clone(),
        req.max_iterations,
        req.interval_minutes,
    ) {
        Ok(monitor) => {
            // Emit event to refresh frontend
            let _ = app.emit("pr:refresh", ());
            (200, ApiResponse::success(monitor))
        }
        Err(e) => (400, ApiResponse::<()>::error(&e)),
    }
}

/// Fetch a single PR from GitHub and cache it
fn fetch_and_cache_pr(state: &AppState, pr_number: i32, repo: &str) -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--repo",
            repo,
            "--json",
            "number,title,url,state,isDraft,author,headRefName,baseRefName,labels,reviewDecision,statusCheckRollup,createdAt,updatedAt",
        ])
        .output()
        .map_err(|e| format!("Failed to execute gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh CLI error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let gh_pr: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let pr_id = format!("{}#{}", repo, pr_number);
    let title = gh_pr["title"].as_str().unwrap_or("Unknown");
    let url = gh_pr["url"].as_str().unwrap_or("");
    let author = gh_pr["author"]["login"].as_str().unwrap_or("unknown");
    let state_str = gh_pr["state"].as_str().unwrap_or("open").to_lowercase();
    let is_draft = gh_pr["isDraft"].as_bool().unwrap_or(false);
    let branch = gh_pr["headRefName"].as_str().unwrap_or("");
    let base_branch = gh_pr["baseRefName"].as_str().unwrap_or("main");
    let created_at = gh_pr["createdAt"].as_str().unwrap_or("");
    let updated_at = gh_pr["updatedAt"].as_str().unwrap_or("");

    // Determine CI status
    let ci_status = gh_pr["statusCheckRollup"]
        .as_array()
        .and_then(|checks| {
            if checks.iter().any(|c| {
                c["conclusion"].as_str() == Some("FAILURE")
                    || c["state"].as_str() == Some("FAILURE")
            }) {
                Some("failing")
            } else if checks.iter().any(|c| {
                c["status"].as_str() == Some("QUEUED")
                    || c["status"].as_str() == Some("IN_PROGRESS")
                    || c["state"].as_str() == Some("PENDING")
            }) {
                Some("pending")
            } else if !checks.is_empty() {
                Some("passing")
            } else {
                None
            }
        });

    // Determine review status
    let review_status = match gh_pr["reviewDecision"].as_str() {
        Some("APPROVED") => "approved",
        Some("CHANGES_REQUESTED") => "changes_requested",
        _ => "pending",
    };

    // Extract labels
    let labels: Vec<String> = gh_pr["labels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    conn.execute(
        r#"
        INSERT INTO pr_cache (
            id, number, repo, title, url, author, state, is_draft,
            ci_status, ci_url, review_status, reviewers, comments_count,
            unresolved_threads, labels, branch, base_branch, created_at,
            updated_at, column_assignment, cached_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, 'monitoring', datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            state = excluded.state,
            is_draft = excluded.is_draft,
            ci_status = excluded.ci_status,
            review_status = excluded.review_status,
            updated_at = excluded.updated_at,
            column_assignment = 'monitoring',
            cached_at = datetime('now')
        "#,
        rusqlite::params![
            pr_id,
            pr_number,
            repo,
            title,
            url,
            author,
            state_str,
            is_draft as i32,
            ci_status,
            Option::<String>::None,
            review_status,
            "[]",
            0,
            0,
            serde_json::to_string(&labels).unwrap_or_else(|_| "[]".to_string()),
            branch,
            base_branch,
            created_at,
            updated_at,
        ],
    )
    .map_err(|e| format!("Failed to cache PR: {}", e))?;

    Ok(())
}

fn handle_stop_monitor<R: Runtime>(app: &AppHandle<R>, pr_id: &str) -> (i32, String) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return (500, ApiResponse::<()>::error("App state not available")),
    };

    // Find active monitor for this PR
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (500, ApiResponse::<()>::error(&format!("DB lock error: {}", e))),
    };

    let monitor_id: Option<String> = conn
        .query_row(
            "SELECT id FROM monitors WHERE pr_id = ?1 AND status IN ('running', 'sleeping')",
            [pr_id],
            |row| row.get(0),
        )
        .ok();

    drop(conn);

    match monitor_id {
        Some(id) => {
            // Kill the process
            if let Err(e) = state.processes.kill(&id) {
                eprintln!("Warning: Failed to kill process: {}", e);
            }

            // Update database
            if let Ok(conn) = state.db.lock() {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = conn.execute(
                    "UPDATE monitors SET status = 'stopped', ended_at = ?1, exit_reason = 'api_stopped' WHERE id = ?2",
                    rusqlite::params![now, id],
                );
            }

            (200, ApiResponse::success(serde_json::json!({"stopped": true, "monitorId": id})))
        }
        None => (404, ApiResponse::<()>::error("No active monitor for this PR")),
    }
}

fn handle_get_monitor<R: Runtime>(app: &AppHandle<R>, pr_id: &str) -> (i32, String) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return (500, ApiResponse::<()>::error("App state not available")),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (500, ApiResponse::<()>::error(&format!("DB lock error: {}", e))),
    };

    let result = conn.query_row(
        r#"
        SELECT id, pr_id, pr_number, repo, pid, status, iteration, max_iterations,
               interval_minutes, started_at, last_check_at, next_check_at, ended_at,
               comments_fixed, exit_reason, log_file
        FROM monitors
        WHERE pr_id = ?1
        ORDER BY started_at DESC
        LIMIT 1
        "#,
        [pr_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "prId": row.get::<_, String>(1)?,
                "prNumber": row.get::<_, i32>(2)?,
                "repo": row.get::<_, String>(3)?,
                "pid": row.get::<_, Option<i32>>(4)?,
                "status": row.get::<_, String>(5)?,
                "iteration": row.get::<_, i32>(6)?,
                "maxIterations": row.get::<_, i32>(7)?,
                "intervalMinutes": row.get::<_, i32>(8)?,
                "startedAt": row.get::<_, String>(9)?,
                "lastCheckAt": row.get::<_, Option<String>>(10)?,
                "nextCheckAt": row.get::<_, Option<String>>(11)?,
                "endedAt": row.get::<_, Option<String>>(12)?,
                "commentsFixed": row.get::<_, i32>(13)?,
                "exitReason": row.get::<_, Option<String>>(14)?,
                "logFile": row.get::<_, String>(15)?,
            }))
        },
    );

    match result {
        Ok(monitor) => (200, ApiResponse::success(monitor)),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            (404, ApiResponse::<()>::error("No monitor found for this PR"))
        }
        Err(e) => (500, ApiResponse::<()>::error(&format!("Database error: {}", e))),
    }
}

fn handle_list_monitors<R: Runtime>(app: &AppHandle<R>) -> (i32, String) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return (500, ApiResponse::<()>::error("App state not available")),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (500, ApiResponse::<()>::error(&format!("DB lock error: {}", e))),
    };

    let mut stmt = match conn.prepare(
        r#"
        SELECT id, pr_id, pr_number, repo, status, iteration, max_iterations
        FROM monitors
        WHERE status IN ('running', 'sleeping')
        ORDER BY started_at DESC
        "#,
    ) {
        Ok(s) => s,
        Err(e) => return (500, ApiResponse::<()>::error(&format!("Query error: {}", e))),
    };

    let monitors: Vec<serde_json::Value> = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "prId": row.get::<_, String>(1)?,
                "prNumber": row.get::<_, i32>(2)?,
                "repo": row.get::<_, String>(3)?,
                "status": row.get::<_, String>(4)?,
                "iteration": row.get::<_, i32>(5)?,
                "maxIterations": row.get::<_, i32>(6)?,
            }))
        })
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    (200, ApiResponse::success(monitors))
}

/// Internal function to start a monitor (mirrors monitor::start_monitor but without State wrapper)
fn start_monitor_internal<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    pr_id: String,
    pr_number: i32,
    repo: String,
    max_iterations: Option<i32>,
    interval_minutes: Option<i32>,
) -> Result<monitor::Monitor, String> {
    use chrono::{Duration, Utc};
    use uuid::Uuid;

    let id = Uuid::new_v4().to_string();
    let max_iter = max_iterations.unwrap_or(10);
    let interval = interval_minutes.unwrap_or(15);
    let now = Utc::now();
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

    // Database operations
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        // Check for existing active monitor
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
            rusqlite::params![
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
        app,
        &id,
        &pr_id,
        pr_number,
        &repo,
        max_iter,
        interval,
    )?;

    // Update the PID
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        conn.execute(
            "UPDATE monitors SET pid = ?1 WHERE id = ?2",
            rusqlite::params![pid as i32, id],
        )
        .map_err(|e| format!("Failed to update monitor PID: {}", e))?;
    }

    // Emit state change event
    if let Ok(count) = monitor::get_active_monitor_count(state) {
        crate::tray::update_tray_status(count);
        crate::dock::set_dock_badge(if count > 0 { Some(count) } else { None });
        let _ = app.emit(
            "monitor:state-changed",
            monitor::MonitorStatePayload { active_count: count },
        );
    }

    Ok(monitor::Monitor {
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
