#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod api;
mod db;
mod dock;
mod hotkey;
mod monitor;
mod notifications;
mod process;
mod settings;
mod sleep_prevention;
mod tray;

use db::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{Manager, State};

/// PR data returned from GitHub CLI
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPR {
    pub number: i32,
    pub title: String,
    pub url: String,
    pub state: String,
    pub is_draft: bool,
    pub author: Author,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub labels: Vec<Label>,
    pub review_decision: Option<String>,
    pub status_check_rollup: Option<Vec<StatusCheck>>,
    pub mergeable: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Author {
    pub login: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Label {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusCheck {
    pub state: Option<String>,
    pub status: Option<String>,
    pub conclusion: Option<String>,
}

/// Normalized PR data for the frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PR {
    pub id: String,
    pub number: i32,
    pub title: String,
    pub url: String,
    pub author: String,
    pub repo: String,
    pub state: String,
    pub is_draft: bool,
    pub ci_status: Option<String>,
    pub ci_url: Option<String>,
    pub review_status: String,
    pub reviewers: Vec<String>,
    pub comments_count: i32,
    pub unresolved_threads: i32,
    pub labels: Vec<String>,
    pub branch: String,
    pub base_branch: String,
    pub created_at: String,
    pub updated_at: String,
    pub category: String,
}

/// Parse GitHub URL or owner/repo format to extract owner/repo
fn parse_repo_path(input: &str) -> String {
    // Handle full GitHub URLs
    if input.contains("github.com") {
        // Extract owner/repo from URL like https://github.com/owner/repo
        if let Some(start) = input.find("github.com/") {
            let path = &input[start + 11..]; // Skip "github.com/"
            let parts: Vec<&str> = path.split('/').take(2).collect();
            if parts.len() == 2 {
                return format!("{}/{}", parts[0], parts[1].trim_end_matches(".git"));
            }
        }
    }
    // Already in owner/repo format
    input.to_string()
}

/// Fetch PRs from GitHub without DB access (pure network call)
/// Used to avoid holding DB lock during network I/O
fn fetch_prs_from_github(repo_path: &str, last_fetch: &Option<String>) -> Result<Vec<PR>, String> {
    // Build search query with optional updated filter
    let search_query = match last_fetch {
        Some(ts) => format!("involves:@me updated:>={}", ts),
        None => "involves:@me".to_string(),
    };

    let args = vec![
        "pr",
        "list",
        "--json",
        "number,title,url,state,isDraft,author,headRefName,baseRefName,labels,reviewDecision,statusCheckRollup,mergeable,createdAt,updatedAt",
        "--limit",
        "50",
        "--repo",
        repo_path,
        "--state",
        "open",
        "--search",
        &search_query,
    ];

    let output = Command::new("gh")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute gh CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh CLI error for {}: {}", repo_path, stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let github_prs: Vec<GitHubPR> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Transform GitHub PRs to our normalized format
    let prs: Vec<PR> = github_prs
        .into_iter()
        .map(|gh_pr| {
            let ci_status = determine_ci_status(&gh_pr.status_check_rollup);
            let review_status = determine_review_status(&gh_pr.review_decision, &gh_pr.mergeable);
            let category = determine_category(&gh_pr.state, false);

            PR {
                id: format!("{}#{}", repo_path, gh_pr.number),
                number: gh_pr.number,
                title: gh_pr.title,
                url: gh_pr.url,
                author: gh_pr.author.login,
                repo: repo_path.to_string(),
                state: gh_pr.state.to_lowercase(),
                is_draft: gh_pr.is_draft,
                ci_status,
                ci_url: None,
                review_status,
                reviewers: vec![],
                comments_count: 0,
                unresolved_threads: 0,
                labels: gh_pr.labels.into_iter().map(|l| l.name).collect(),
                branch: gh_pr.head_ref_name,
                base_branch: gh_pr.base_ref_name,
                created_at: gh_pr.created_at,
                updated_at: gh_pr.updated_at,
                category,
            }
        })
        .collect();

    Ok(prs)
}

/// Cache a PR in the database
fn cache_pr(conn: &rusqlite::Connection, pr: &PR) -> rusqlite::Result<()> {
    conn.execute(
        r#"
        INSERT INTO pr_cache (
            id, number, repo, title, url, author, state, is_draft,
            ci_status, ci_url, review_status, reviewers, comments_count,
            unresolved_threads, labels, branch, base_branch, created_at,
            updated_at, column_assignment, cached_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            state = excluded.state,
            is_draft = excluded.is_draft,
            ci_status = excluded.ci_status,
            ci_url = excluded.ci_url,
            review_status = excluded.review_status,
            reviewers = excluded.reviewers,
            comments_count = excluded.comments_count,
            labels = excluded.labels,
            updated_at = excluded.updated_at,
            cached_at = datetime('now')
        "#,
        rusqlite::params![
            pr.id,
            pr.number,
            pr.repo,
            pr.title,
            pr.url,
            pr.author,
            pr.state,
            pr.is_draft as i32,
            pr.ci_status,
            pr.ci_url,
            pr.review_status,
            serde_json::to_string(&pr.reviewers).unwrap_or_else(|_| "[]".to_string()),
            pr.comments_count,
            pr.unresolved_threads,
            serde_json::to_string(&pr.labels).unwrap_or_else(|_| "[]".to_string()),
            pr.branch,
            pr.base_branch,
            pr.created_at,
            pr.updated_at,
            pr.category,
        ],
    )?;
    Ok(())
}

/// Get cached PRs for a specific repo
fn get_cached_prs_for_repo(conn: &rusqlite::Connection, repo: &str) -> Result<Vec<PR>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, number, repo, title, url, author, state, is_draft,
                   ci_status, ci_url, review_status, reviewers, comments_count,
                   unresolved_threads, labels, branch, base_branch, created_at,
                   updated_at, column_assignment
            FROM pr_cache
            WHERE repo = ?1
            ORDER BY updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let prs = stmt
        .query_map([repo], |row| {
            let reviewers_json: String = row.get(11)?;
            let labels_json: String = row.get(14)?;

            Ok(PR {
                id: row.get(0)?,
                number: row.get(1)?,
                repo: row.get(2)?,
                title: row.get(3)?,
                url: row.get(4)?,
                author: row.get(5)?,
                state: row.get(6)?,
                is_draft: row.get::<_, i32>(7)? != 0,
                ci_status: row.get(8)?,
                ci_url: row.get(9)?,
                review_status: row.get(10)?,
                reviewers: serde_json::from_str(&reviewers_json).unwrap_or_default(),
                comments_count: row.get(12)?,
                unresolved_threads: row.get(13)?,
                labels: serde_json::from_str(&labels_json).unwrap_or_default(),
                branch: row.get(15)?,
                base_branch: row.get(16)?,
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
                category: row.get(19)?,
            })
        })
        .map_err(|e| format!("Query failed: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read rows: {}", e))?;

    Ok(prs)
}

/// Fetch PRs from GitHub using gh CLI with incremental caching
/// Supports single repo (repo param) or multiple repos (repos param)
/// Set force_refresh=true to bypass cache and fetch all PRs
#[tauri::command]
fn fetch_prs(
    state: State<'_, AppState>,
    repo: Option<String>,
    repos: Option<Vec<String>>,
    force_refresh: Option<bool>,
) -> Result<Vec<PR>, String> {
    let force = force_refresh.unwrap_or(false);

    // Determine which repos to fetch from (brief lock)
    let repos_to_fetch: Vec<String> = {
        match (repos, repo) {
            // Multiple repos specified
            (Some(r), _) if !r.is_empty() => r,
            // Single repo specified
            (_, Some(r)) if !r.is_empty() => vec![r],
            // No repos - try to get current repo from working directory
            _ => {
                if let Some(current) = get_current_repo() {
                    vec![current]
                } else {
                    return Err("No repository specified and not in a git repository".to_string());
                }
            }
        }
    };

    // Phase 1: Get last_fetch timestamps (brief lock, release before network)
    let fetch_metadata: Vec<(String, Option<String>)> = {
        let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
        repos_to_fetch
            .iter()
            .map(|r| {
                let repo_path = parse_repo_path(r);
                let last_fetch = if force {
                    None
                } else {
                    db::get_last_fetch(&conn, &repo_path).ok().flatten()
                };
                (repo_path, last_fetch)
            })
            .collect()
    }; // Lock released here

    // Phase 2: Fetch from GitHub (NO lock held during network calls)
    let mut fetched_data: Vec<(String, Option<String>, Vec<PR>)> = Vec::new();
    for (repo_path, last_fetch) in fetch_metadata {
        match fetch_prs_from_github(&repo_path, &last_fetch) {
            Ok(prs) => fetched_data.push((repo_path, last_fetch, prs)),
            Err(e) => {
                eprintln!("Failed to fetch PRs from {}: {}", repo_path, e);
            }
        }
    }

    // Phase 3: Save to database and collect results (re-acquire lock)
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut all_prs: Vec<PR> = Vec::new();

    for (repo_path, last_fetch, prs) in fetched_data {
        // Cache PRs in database
        for pr in &prs {
            if let Err(e) = cache_pr(&conn, pr) {
                eprintln!("Failed to cache PR: {}", e);
            }
        }

        // Update last fetch timestamp
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        if let Err(e) = db::set_last_fetch(&conn, &repo_path, &now, prs.len() as i32) {
            eprintln!("Failed to update fetch metadata: {}", e);
        }

        // Check for merged/closed PRs on full refresh
        // Instead of deleting, update their state so they show in "done" category
        if last_fetch.is_none() {
            let active_ids: Vec<String> = prs.iter().map(|pr| pr.id.clone()).collect();
            match db::get_stale_pr_ids(&conn, &repo_path, &active_ids) {
                Ok(stale_prs) if !stale_prs.is_empty() => {
                    println!("Found {} potentially merged/closed PRs, checking status...", stale_prs.len());
                    for (pr_id, pr_number) in stale_prs {
                        // Check PR state via GitHub API
                        if let Some((state, _)) = check_pr_state(&repo_path, pr_number) {
                            let category = determine_category(&state, false);
                            if let Err(e) = db::update_pr_state(&conn, &pr_id, &state, &category) {
                                eprintln!("Failed to update PR state: {}", e);
                            } else {
                                println!("Updated PR #{} to state: {} (category: {})", pr_number, state, category);
                            }
                        }
                    }
                }
                Err(e) => eprintln!("Warning: Failed to get stale PRs: {}", e),
                _ => {}
            }
        }

        // Always return from cache so merged/closed PRs are included
        match get_cached_prs_for_repo(&conn, &repo_path) {
            Ok(cached) => all_prs.extend(cached),
            Err(e) => eprintln!("Failed to get cached PRs: {}", e),
        }
    }

    Ok(all_prs)
}

/// Get cached PRs without making network requests
#[tauri::command]
fn get_cached_prs(
    state: State<'_, AppState>,
    repo: Option<String>,
    repos: Option<Vec<String>>,
) -> Result<Vec<PR>, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;

    // Determine which repos to get from
    let repos_to_fetch: Vec<String> = match (repos, repo) {
        (Some(r), _) if !r.is_empty() => r,
        (_, Some(r)) if !r.is_empty() => vec![r],
        _ => {
            // Get all repos from cache
            let mut stmt = conn
                .prepare("SELECT DISTINCT repo FROM pr_cache")
                .map_err(|e| format!("DB error: {}", e))?;
            let repos: Vec<String> = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| format!("Query error: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            repos
        }
    };

    let mut all_prs: Vec<PR> = Vec::new();
    for repo in repos_to_fetch {
        let repo_path = parse_repo_path(&repo);
        match get_cached_prs_for_repo(&conn, &repo_path) {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => eprintln!("Failed to get cached PRs for {}: {}", repo, e),
        }
    }

    Ok(all_prs)
}

/// Clear the PR cache
#[tauri::command]
fn clear_pr_cache(state: State<'_, AppState>, repo: Option<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    db::clear_pr_cache(&conn, repo.as_deref()).map_err(|e| format!("Failed to clear cache: {}", e))
}

/// Dismiss a PR (remove from the dashboard)
#[tauri::command]
fn dismiss_pr(state: State<'_, AppState>, pr_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    db::dismiss_pr(&conn, &pr_id).map_err(|e| format!("Failed to dismiss PR: {}", e))?;
    Ok(())
}

fn get_current_repo() -> Option<String> {
    let output = Command::new("gh")
        .args(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Some(stdout.trim().to_string())
    } else {
        None
    }
}

fn determine_ci_status(status_checks: &Option<Vec<StatusCheck>>) -> Option<String> {
    let checks = status_checks.as_ref()?;
    if checks.is_empty() {
        return None;
    }

    // Check if any are failing (conclusion can be uppercase or lowercase)
    let has_failure = checks.iter().any(|c| {
        matches!(
            c.conclusion.as_deref().map(|s| s.to_uppercase()).as_deref(),
            Some("FAILURE")
        )
    });
    if has_failure {
        return Some("failing".to_string());
    }

    // Check if any are pending/in-progress
    // - status: QUEUED, IN_PROGRESS (GitHub CI)
    // - state: PENDING (status checks)
    // - conclusion is empty string when still running
    let has_pending = checks.iter().any(|c| {
        let status_upper = c.status.as_deref().map(|s| s.to_uppercase());
        let state_upper = c.state.as_deref().map(|s| s.to_uppercase());
        let conclusion = c.conclusion.as_deref();

        matches!(status_upper.as_deref(), Some("QUEUED") | Some("IN_PROGRESS"))
            || matches!(state_upper.as_deref(), Some("PENDING"))
            || conclusion == Some("") // Empty conclusion means still running
    });
    if has_pending {
        return Some("pending".to_string());
    }

    // All passing
    Some("passing".to_string())
}

fn determine_review_status(review_decision: &Option<String>, mergeable: &Option<String>) -> String {
    // Check for merge conflicts first - they take priority
    if mergeable.as_deref() == Some("CONFLICTING") {
        return "conflicts".to_string();
    }

    match review_decision.as_deref() {
        Some("APPROVED") => "approved".to_string(),
        Some("CHANGES_REQUESTED") => "changes_requested".to_string(),
        Some("REVIEW_REQUIRED") => "pending".to_string(),
        _ => "pending".to_string(),
    }
}

/// Check the state of a single PR via GitHub API
/// Returns (state, merged_at) where state is "open", "merged", or "closed"
fn check_pr_state(repo: &str, pr_number: i32) -> Option<(String, Option<String>)> {
    let output = Command::new("gh")
        .args([
            "pr", "view",
            &pr_number.to_string(),
            "--repo", repo,
            "--json", "state,mergedAt",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).ok()?;

    let state = json.get("state")?.as_str()?.to_lowercase();
    let merged_at = json.get("mergedAt").and_then(|v| v.as_str()).map(|s| s.to_string());

    Some((state, merged_at))
}

fn determine_category(state: &str, is_monitoring: bool) -> String {
    if is_monitoring {
        return "monitoring".to_string();
    }
    match state.to_lowercase().as_str() {
        "open" => "todo".to_string(),
        "merged" | "closed" => "done".to_string(),
        _ => "todo".to_string(),
    }
}

/// Update sleep prevention state based on current monitors and setting
#[tauri::command]
fn sync_sleep_prevention(state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;

    // Check if feature is enabled
    let enabled = db::get_setting_value(&conn, "sleep_prevention_enabled")
        .map(|v| v == "true")
        .unwrap_or(false);

    // Get active monitor count
    let count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM monitors WHERE status IN ('running', 'sleeping')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count monitors: {}", e))?;

    sleep_prevention::update_sleep_state(count, enabled);

    Ok(sleep_prevention::is_sleep_prevented())
}

/// Get current sleep prevention status
#[tauri::command]
fn get_sleep_prevention_status() -> bool {
    sleep_prevention::is_sleep_prevented()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None),
        )
        .setup(|app| {
            // Initialize database
            let db_path = db::get_db_path().expect("Failed to get database path");
            let state = AppState::new(db_path).expect("Failed to initialize database");

            // Initialize schema
            {
                let conn = state.db.lock().unwrap();
                db::init_schema(&conn).expect("Failed to initialize database schema");
            }

            // Store state for use in commands
            app.manage(state);

            // Create system tray
            tray::create_tray(app.handle())?;

            // Register global hotkey (Cmd+Shift+P to toggle window)
            if let Err(e) = hotkey::register_global_hotkey(app.handle()) {
                eprintln!("Failed to register global hotkey: {}", e);
            }

            // Minimize to tray on close (hide instead of quit)
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent the window from closing, hide it instead
                        api.prevent_close();
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                });
            }

            // Start HTTP API server for external integrations (e.g., Claude Code)
            api::start_api_server(app.handle().clone());

            println!("Clanker Spanker initialized successfully");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_prs,
            get_cached_prs,
            clear_pr_cache,
            dismiss_pr,
            settings::get_repos,
            settings::add_repo,
            settings::remove_repo,
            settings::get_selected_repo,
            settings::set_selected_repo,
            settings::get_setting,
            settings::set_setting,
            monitor::start_monitor,
            monitor::stop_monitor,
            monitor::get_monitors,
            monitor::get_monitor,
            monitor::get_monitor_for_pr,
            monitor::get_recent_monitor_for_pr,
            monitor::read_monitor_log,
            monitor::fetch_pr_comments,
            monitor::get_pr_comments,
            notifications::notify_pr_clean,
            notifications::notify_comment_found,
            notifications::notify_monitor_complete,
            notifications::notify_monitor_failed,
            notifications::show_and_focus_pr,
            sync_sleep_prevention,
            get_sleep_prevention_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Cleanup: Kill all running monitor processes
                if let Some(state) = app_handle.try_state::<AppState>() {
                    println!("Cleaning up monitor processes...");
                    state.processes.kill_all();
                }
                // Cleanup: Release sleep prevention assertion
                if let Err(e) = sleep_prevention::allow_sleep() {
                    eprintln!("Warning: Failed to release sleep assertion on exit: {}", e);
                }
            }
        });
}
