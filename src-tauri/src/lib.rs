#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod db;
mod dock;
mod hotkey;
mod monitor;
mod notifications;
mod process;
mod settings;
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
    pub column: String,
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

/// Fetch PRs from a single GitHub repository with incremental support
fn fetch_prs_for_repo(
    repo: &str,
    conn: &rusqlite::Connection,
    force_refresh: bool,
) -> Result<Vec<PR>, String> {
    // Parse repo in case it's a URL
    let repo_path = parse_repo_path(repo);

    // Check for last fetch time (for incremental fetching)
    let last_fetch = if force_refresh {
        None
    } else {
        db::get_last_fetch(conn, &repo_path).map_err(|e| format!("DB error: {}", e))?
    };

    // Build search query with optional updated filter
    let search_query = match &last_fetch {
        Some(ts) => format!("involves:@me updated:>={}", ts),
        None => "involves:@me".to_string(),
    };

    // Removed 'comments' from JSON fields - we don't need full comment objects
    let args = vec![
        "pr",
        "list",
        "--json",
        "number,title,url,state,isDraft,author,headRefName,baseRefName,labels,reviewDecision,statusCheckRollup,createdAt,updatedAt",
        "--limit",
        "50",
        "--repo",
        &repo_path,
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
            let review_status = determine_review_status(&gh_pr.review_decision);
            let column = determine_column(&gh_pr.state, false);

            PR {
                id: format!("{}#{}", repo_path, gh_pr.number),
                number: gh_pr.number,
                title: gh_pr.title,
                url: gh_pr.url,
                author: gh_pr.author.login,
                repo: repo_path.clone(),
                state: gh_pr.state.to_lowercase(),
                is_draft: gh_pr.is_draft,
                ci_status,
                ci_url: None,
                review_status,
                reviewers: vec![],
                comments_count: 0, // Will be populated when fetching review threads
                unresolved_threads: 0,
                labels: gh_pr.labels.into_iter().map(|l| l.name).collect(),
                branch: gh_pr.head_ref_name,
                base_branch: gh_pr.base_ref_name,
                created_at: gh_pr.created_at,
                updated_at: gh_pr.updated_at,
                column,
            }
        })
        .collect();

    // Cache PRs in database
    for pr in &prs {
        cache_pr(conn, pr).map_err(|e| format!("Failed to cache PR: {}", e))?;
    }

    // Update last fetch timestamp
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    db::set_last_fetch(conn, &repo_path, &now, prs.len() as i32)
        .map_err(|e| format!("Failed to update fetch metadata: {}", e))?;

    // If this was an incremental fetch, we need to return all cached PRs for this repo
    if last_fetch.is_some() {
        return get_cached_prs_for_repo(conn, &repo_path);
    }

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
            pr.column,
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
            WHERE repo = ?1 AND state = 'open'
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
                column: row.get(19)?,
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
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;

    // Determine which repos to fetch from
    let repos_to_fetch: Vec<String> = match (repos, repo) {
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
    };

    // Fetch PRs from all repos (sequentially for simplicity)
    let mut all_prs: Vec<PR> = Vec::new();

    for repo in repos_to_fetch {
        match fetch_prs_for_repo(&repo, &conn, force) {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => {
                // Log error but continue with other repos
                eprintln!("Failed to fetch PRs from {}: {}", repo, e);
            }
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

    // Check if any are failing
    let has_failure = checks.iter().any(|c| {
        c.conclusion.as_deref() == Some("FAILURE")
            || c.conclusion.as_deref() == Some("failure")
            || c.state.as_deref() == Some("FAILURE")
    });
    if has_failure {
        return Some("failing".to_string());
    }

    // Check if any are pending
    let has_pending = checks.iter().any(|c| {
        c.status.as_deref() == Some("QUEUED")
            || c.status.as_deref() == Some("IN_PROGRESS")
            || c.state.as_deref() == Some("PENDING")
    });
    if has_pending {
        return Some("pending".to_string());
    }

    // All passing
    Some("passing".to_string())
}

fn determine_review_status(review_decision: &Option<String>) -> String {
    match review_decision.as_deref() {
        Some("APPROVED") => "approved".to_string(),
        Some("CHANGES_REQUESTED") => "changes_requested".to_string(),
        Some("REVIEW_REQUIRED") => "pending".to_string(),
        _ => "pending".to_string(),
    }
}

fn determine_column(state: &str, is_monitoring: bool) -> String {
    if is_monitoring {
        return "monitoring".to_string();
    }
    match state.to_lowercase().as_str() {
        "open" => "todo".to_string(),
        "merged" | "closed" => "done".to_string(),
        _ => "todo".to_string(),
    }
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

            println!("Clanker Spanker initialized successfully");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_prs,
            get_cached_prs,
            clear_pr_cache,
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
            monitor::fetch_pr_comments,
            monitor::get_pr_comments,
            notifications::notify_pr_clean,
            notifications::notify_comment_found,
            notifications::notify_monitor_complete,
            notifications::notify_monitor_failed,
            notifications::show_and_focus_pr
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
            }
        });
}
