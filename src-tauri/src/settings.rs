use crate::db::{self, AppState};
use crate::global_settings::{self, GlobalSettings};
use serde::Serialize;
use std::process::Command;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableRunners {
    pub claude: Option<ClaudeInfo>,
    pub codex: Option<CodexInfo>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningLevel {
    pub effort: String,
    pub description: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub slug: String,
    pub display_name: String,
    pub default_reasoning_level: Option<String>,
    pub supported_reasoning_levels: Vec<ReasoningLevel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInfo {
    pub available: bool,
    pub models: Vec<ModelInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInfo {
    pub available: bool,
    pub models: Vec<ModelInfo>,
    pub current_model: Option<String>,
}

/// Detect available CLI runners and their models
#[tauri::command]
pub fn detect_runners() -> AvailableRunners {
    AvailableRunners {
        claude: detect_claude(),
        codex: detect_codex(),
    }
}

fn detect_claude() -> Option<ClaudeInfo> {
    // Check if claude CLI is available
    let output = Command::new("claude")
        .arg("--version")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    // Claude models with their known capabilities
    let models = vec![
        ModelInfo {
            slug: "opus".to_string(),
            display_name: "Opus".to_string(),
            default_reasoning_level: None,
            supported_reasoning_levels: vec![],
        },
        ModelInfo {
            slug: "sonnet".to_string(),
            display_name: "Sonnet".to_string(),
            default_reasoning_level: None,
            supported_reasoning_levels: vec![],
        },
        ModelInfo {
            slug: "haiku".to_string(),
            display_name: "Haiku".to_string(),
            default_reasoning_level: None,
            supported_reasoning_levels: vec![],
        },
    ];

    Some(ClaudeInfo {
        available: true,
        models,
    })
}

fn detect_codex() -> Option<CodexInfo> {
    // Try the known Codex CLI path
    let codex_path = dirs::home_dir()?
        .join("Library/Application Support/com.conductor.app/./bin/codex");

    let output = Command::new(&codex_path)
        .arg("--version")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let home = dirs::home_dir()?;

    // Read current model from config
    let config_path = home.join(".codex/config.toml");
    let current_model = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|content| {
            for line in content.lines() {
                if line.starts_with("model") {
                    // Parse: model = "gpt-5.4"
                    if let Some(val) = line.split('=').nth(1) {
                        return Some(val.trim().trim_matches('"').to_string());
                    }
                }
            }
            None
        });

    // Read available models from cache file with full details
    let cache_path = home.join(".codex/models_cache.json");
    let models = std::fs::read_to_string(&cache_path)
        .ok()
        .and_then(|content| {
            let json: serde_json::Value = serde_json::from_str(&content).ok()?;
            let models_array = json.get("models")?.as_array()?;
            let model_infos: Vec<ModelInfo> = models_array
                .iter()
                .filter_map(|m| {
                    let slug = m.get("slug")?.as_str()?.to_string();
                    let display_name = m.get("display_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&slug)
                        .to_string();
                    let default_reasoning_level = m.get("default_reasoning_level")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let supported_reasoning_levels = m.get("supported_reasoning_levels")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|level| {
                                    Some(ReasoningLevel {
                                        effort: level.get("effort")?.as_str()?.to_string(),
                                        description: level.get("description")?.as_str()?.to_string(),
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    Some(ModelInfo {
                        slug,
                        display_name,
                        default_reasoning_level,
                        supported_reasoning_levels,
                    })
                })
                .collect();
            Some(model_infos)
        })
        .unwrap_or_else(|| {
            // Fallback to common models if cache not found
            vec![
                ModelInfo {
                    slug: "gpt-5.4".to_string(),
                    display_name: "gpt-5.4".to_string(),
                    default_reasoning_level: Some("medium".to_string()),
                    supported_reasoning_levels: vec![
                        ReasoningLevel { effort: "low".to_string(), description: "Fast responses".to_string() },
                        ReasoningLevel { effort: "medium".to_string(), description: "Balanced".to_string() },
                        ReasoningLevel { effort: "high".to_string(), description: "Deep reasoning".to_string() },
                    ],
                },
                ModelInfo {
                    slug: "gpt-5.3-codex".to_string(),
                    display_name: "gpt-5.3-codex".to_string(),
                    default_reasoning_level: Some("medium".to_string()),
                    supported_reasoning_levels: vec![
                        ReasoningLevel { effort: "low".to_string(), description: "Fast responses".to_string() },
                        ReasoningLevel { effort: "medium".to_string(), description: "Balanced".to_string() },
                        ReasoningLevel { effort: "high".to_string(), description: "Deep reasoning".to_string() },
                    ],
                },
            ]
        });

    Some(CodexInfo {
        available: true,
        models,
        current_model,
    })
}

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

/// Get global settings (creates defaults if missing)
#[tauri::command]
pub fn get_global_settings(state: State<'_, AppState>) -> Result<GlobalSettings, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    global_settings::ensure_global_settings(&conn)
}

/// Set global settings
#[tauri::command]
pub fn set_global_settings(
    state: State<'_, AppState>,
    settings: GlobalSettings,
) -> Result<GlobalSettings, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("Failed to lock database: {}", e))?;

    global_settings::save_global_settings(&conn, &settings)?;
    Ok(settings)
}
