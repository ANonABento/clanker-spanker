use crate::db::{self, AppState};
use tauri::State;

/// Get all configured repositories
#[tauri::command]
pub fn get_repos(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let repos_json = db::get_setting(&conn, "repos")
        .map_err(|e| format!("Database error: {}", e))?
        .unwrap_or_else(|| "[]".to_string());

    serde_json::from_str(&repos_json).map_err(|e| format!("Failed to parse repos: {}", e))
}

/// Add a repository to the list
#[tauri::command]
pub fn add_repo(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    // Get current repos
    let repos_json = db::get_setting(&conn, "repos")
        .map_err(|e| format!("Database error: {}", e))?
        .unwrap_or_else(|| "[]".to_string());

    let mut repos: Vec<String> =
        serde_json::from_str(&repos_json).map_err(|e| format!("Failed to parse repos: {}", e))?;

    // Add if not already present
    if !repos.contains(&repo) {
        repos.push(repo);
        let new_json =
            serde_json::to_string(&repos).map_err(|e| format!("Failed to serialize repos: {}", e))?;
        db::set_setting(&conn, "repos", &new_json)
            .map_err(|e| format!("Database error: {}", e))?;
    }

    Ok(())
}

/// Remove a repository from the list
#[tauri::command]
pub fn remove_repo(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    // Get current repos
    let repos_json = db::get_setting(&conn, "repos")
        .map_err(|e| format!("Database error: {}", e))?
        .unwrap_or_else(|| "[]".to_string());

    let mut repos: Vec<String> =
        serde_json::from_str(&repos_json).map_err(|e| format!("Failed to parse repos: {}", e))?;

    // Remove if present
    repos.retain(|r| r != &repo);
    let new_json =
        serde_json::to_string(&repos).map_err(|e| format!("Failed to serialize repos: {}", e))?;
    db::set_setting(&conn, "repos", &new_json).map_err(|e| format!("Database error: {}", e))?;

    Ok(())
}

/// Get the currently selected repository
#[tauri::command]
pub fn get_selected_repo(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    db::get_setting(&conn, "selected_repo")
        .map_err(|e| format!("Database error: {}", e))?
        .ok_or_else(|| "Setting not found".to_string())
}

/// Set the currently selected repository
#[tauri::command]
pub fn set_selected_repo(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    db::set_setting(&conn, "selected_repo", &repo)
        .map_err(|e| format!("Database error: {}", e))
}

/// Get a generic setting by key
#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    db::get_setting(&conn, &key).map_err(|e| format!("Database error: {}", e))
}

/// Set a generic setting by key
#[tauri::command]
pub fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    db::set_setting(&conn, &key, &value).map_err(|e| format!("Database error: {}", e))
}
