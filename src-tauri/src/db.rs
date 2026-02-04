use crate::process::ProcessRegistry;
use rusqlite::{Connection, Result as SqliteResult};
use std::path::PathBuf;
use std::sync::Mutex;

/// Application state holding the database connection and process registry
pub struct AppState {
    pub db: Mutex<Connection>,
    pub processes: ProcessRegistry,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable foreign keys
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

        Ok(Self {
            db: Mutex::new(conn),
            processes: ProcessRegistry::new(),
        })
    }
}

/// Get the database path in the app data directory
pub fn get_db_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| "Failed to get local data directory".to_string())?;

    let app_dir = data_dir.join("com.clanker-spanker.app");

    // Create app directory if it doesn't exist
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app directory: {}", e))?;

    Ok(app_dir.join("clanker-spanker.db"))
}

/// Initialize the database schema
pub fn init_schema(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        r#"
        -- monitors: Track active and historical monitor sessions
        CREATE TABLE IF NOT EXISTS monitors (
            id TEXT PRIMARY KEY,
            pr_id TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            repo TEXT NOT NULL,
            pid INTEGER,
            status TEXT NOT NULL DEFAULT 'running',
            iteration INTEGER NOT NULL DEFAULT 0,
            max_iterations INTEGER NOT NULL DEFAULT 10,
            interval_minutes INTEGER NOT NULL DEFAULT 5,
            started_at TEXT NOT NULL,
            last_check_at TEXT,
            next_check_at TEXT,
            ended_at TEXT,
            comments_fixed INTEGER NOT NULL DEFAULT 0,
            exit_reason TEXT,
            log_file TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_monitors_status ON monitors(status);
        CREATE INDEX IF NOT EXISTS idx_monitors_pr_id ON monitors(pr_id);
        CREATE INDEX IF NOT EXISTS idx_monitors_repo ON monitors(repo);

        -- monitor_logs: Detailed log entries for each iteration
        CREATE TABLE IF NOT EXISTS monitor_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
            iteration INTEGER NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            action TEXT NOT NULL,
            message TEXT,
            comments_found INTEGER DEFAULT 0,
            comments_fixed INTEGER DEFAULT 0,
            error_type TEXT,
            error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_monitor_logs_monitor_id ON monitor_logs(monitor_id);

        -- settings: User preferences
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Default settings
        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('selected_repo', ''),
            ('default_max_iterations', '10'),
            ('default_interval_minutes', '15');

        -- pr_cache: Cached PR metadata for incremental fetching
        CREATE TABLE IF NOT EXISTS pr_cache (
            id TEXT PRIMARY KEY,
            number INTEGER NOT NULL,
            repo TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            author TEXT NOT NULL,
            state TEXT NOT NULL,
            is_draft INTEGER NOT NULL DEFAULT 0,
            ci_status TEXT,
            ci_url TEXT,
            review_status TEXT NOT NULL,
            reviewers TEXT NOT NULL DEFAULT '[]',
            comments_count INTEGER NOT NULL DEFAULT 0,
            unresolved_threads INTEGER NOT NULL DEFAULT 0,
            labels TEXT NOT NULL DEFAULT '[]',
            branch TEXT NOT NULL,
            base_branch TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            column_assignment TEXT NOT NULL DEFAULT 'todo',
            cached_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(repo, number)
        );

        CREATE INDEX IF NOT EXISTS idx_pr_cache_repo ON pr_cache(repo);
        CREATE INDEX IF NOT EXISTS idx_pr_cache_updated ON pr_cache(updated_at);
        CREATE INDEX IF NOT EXISTS idx_pr_cache_state ON pr_cache(state);

        -- fetch_metadata: Track last fetch time per repo for incremental fetching
        CREATE TABLE IF NOT EXISTS fetch_metadata (
            repo TEXT PRIMARY KEY,
            last_fetch_at TEXT NOT NULL,
            last_fetch_count INTEGER DEFAULT 0
        );

        -- pr_comments: Unresolved review thread comments
        CREATE TABLE IF NOT EXISTS pr_comments (
            id TEXT PRIMARY KEY,
            pr_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            comment_type TEXT NOT NULL DEFAULT 'review_thread',
            is_resolved INTEGER NOT NULL DEFAULT 0,
            author TEXT NOT NULL,
            body TEXT NOT NULL,
            path TEXT,
            line INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (pr_id) REFERENCES pr_cache(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments(pr_id);
        CREATE INDEX IF NOT EXISTS idx_pr_comments_unresolved ON pr_comments(pr_id, is_resolved);
        CREATE INDEX IF NOT EXISTS idx_pr_comments_thread ON pr_comments(thread_id);
        "#,
    )
}

/// Get a setting value
pub fn get_setting(conn: &Connection, key: &str) -> SqliteResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;

    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// Set a setting value
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> SqliteResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
        [key, value],
    )?;
    Ok(())
}

/// Get the last fetch time for a repo
pub fn get_last_fetch(conn: &Connection, repo: &str) -> SqliteResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT last_fetch_at FROM fetch_metadata WHERE repo = ?1")?;
    let mut rows = stmt.query([repo])?;

    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// Update the last fetch time for a repo
pub fn set_last_fetch(conn: &Connection, repo: &str, timestamp: &str, count: i32) -> SqliteResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO fetch_metadata (repo, last_fetch_at, last_fetch_count) VALUES (?1, ?2, ?3)",
        rusqlite::params![repo, timestamp, count],
    )?;
    Ok(())
}

/// Clear all PR cache (for debugging or forced refresh)
pub fn clear_pr_cache(conn: &Connection, repo: Option<&str>) -> SqliteResult<()> {
    if let Some(repo) = repo {
        conn.execute("DELETE FROM pr_cache WHERE repo = ?1", [repo])?;
        conn.execute("DELETE FROM fetch_metadata WHERE repo = ?1", [repo])?;
    } else {
        conn.execute("DELETE FROM pr_cache", [])?;
        conn.execute("DELETE FROM fetch_metadata", [])?;
    }
    Ok(())
}

/// Delete stale PRs that are no longer open
pub fn delete_stale_prs(conn: &Connection, repo: &str, active_pr_ids: &[String]) -> SqliteResult<usize> {
    if active_pr_ids.is_empty() {
        return Ok(0);
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = (0..active_pr_ids.len())
        .map(|i| format!("?{}", i + 2))
        .collect();
    let placeholders_str = placeholders.join(",");

    let sql = format!(
        "DELETE FROM pr_cache WHERE repo = ?1 AND id NOT IN ({})",
        placeholders_str
    );

    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&repo];
    for id in active_pr_ids {
        params.push(id);
    }

    let deleted = conn.execute(&sql, rusqlite::params_from_iter(params))?;
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_creation() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        // Verify tables exist
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='monitors'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_settings() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        // Test default setting
        let selected_repo = get_setting(&conn, "selected_repo").unwrap();
        assert_eq!(selected_repo, Some("".to_string()));

        // Test setting update
        set_setting(&conn, "selected_repo", "owner/repo").unwrap();
        let selected_repo = get_setting(&conn, "selected_repo").unwrap();
        assert_eq!(selected_repo, Some("owner/repo".to_string()));
    }
}
