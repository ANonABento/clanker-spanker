use crate::db::{self, AppState};
use serde::Serialize;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveAiModel {
    pub provider: String,
    pub model: String,
    pub source: String, // override | provider_default | unknown
}

fn read_claude_default_model() -> Option<String> {
    let path = dirs::home_dir()?.join(".claude").join("settings.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("model")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn read_codex_default_model() -> Option<String> {
    let path = dirs::home_dir()?.join(".codex").join("config.toml");
    let raw = std::fs::read_to_string(path).ok()?;

    let mut table_name = String::new();
    let mut root_model: Option<String> = None;
    let mut profile_default_model: Option<String> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') {
            table_name = trimmed
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim()
                .to_string();
            continue;
        }

        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != "model" {
            continue;
        }

        let value_no_comment = value.split('#').next().unwrap_or("").trim();
        let parsed = value_no_comment
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_string();
        if parsed.is_empty() {
            continue;
        }

        if table_name.is_empty() {
            root_model = Some(parsed);
        } else if table_name == "profiles.default" || table_name == "profile.default" {
            profile_default_model = Some(parsed);
        }
    }

    root_model.or(profile_default_model)
}

/// Get the effective AI provider/model currently used for new monitors.
#[tauri::command]
pub fn get_effective_ai_model(state: State<'_, AppState>) -> Result<EffectiveAiModel, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    let (provider, override_model) = db::get_ai_config(&conn);
    drop(conn);

    if let Some(model) = override_model {
        return Ok(EffectiveAiModel {
            provider,
            model,
            source: "override".to_string(),
        });
    }

    let default_model = match provider.as_str() {
        "codex" => read_codex_default_model(),
        _ => read_claude_default_model(),
    };

    match default_model {
        Some(model) => Ok(EffectiveAiModel {
            provider,
            model,
            source: "provider_default".to_string(),
        }),
        None => Ok(EffectiveAiModel {
            provider,
            model: "Unknown".to_string(),
            source: "unknown".to_string(),
        }),
    }
}
