use crate::db;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const GLOBAL_SETTINGS_KEY: &str = "global_settings";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSettings {
    pub runner: String,
    pub steps: String,
    pub auto_start_draft_to_open: bool,
    pub pr_scope: String,
    pub schedule: ScheduleSettings,
    pub default_iterations: i32,
    pub interval_minutes: i32,
    pub concurrency_cap: i32,
    pub max_jobs_per_night: i32,
    pub pending_wait_minutes: i32,
    pub push_enabled: bool,
    pub commit_message_template: String,
    pub notifications: NotificationSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSettings {
    pub enabled: bool,
    pub days: Vec<String>,
    pub time: String,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    pub on_start: bool,
    pub on_complete: bool,
    pub on_failure: bool,
}

impl Default for ScheduleSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            days: vec![
                "mon".to_string(),
                "tue".to_string(),
                "wed".to_string(),
                "thu".to_string(),
                "fri".to_string(),
            ],
            time: "22:00".to_string(),
            timezone: "local".to_string(),
        }
    }
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            on_start: false,
            on_complete: true,
            on_failure: true,
        }
    }
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            runner: "auto".to_string(),
            steps: "both".to_string(),
            auto_start_draft_to_open: false,
            pr_scope: "all".to_string(),
            schedule: ScheduleSettings::default(),
            default_iterations: 10,
            interval_minutes: 15,
            concurrency_cap: 20,
            max_jobs_per_night: 40,
            pending_wait_minutes: 15,
            push_enabled: true,
            commit_message_template: "Fix PR #{{prNumber}} feedback".to_string(),
            notifications: NotificationSettings::default(),
        }
    }
}

pub fn save_global_settings(conn: &Connection, settings: &GlobalSettings) -> Result<(), String> {
    let json = serde_json::to_string(settings)
        .map_err(|e| format!("Failed to serialize global settings: {}", e))?;

    db::set_setting(conn, GLOBAL_SETTINGS_KEY, &json)
        .map_err(|e| format!("Database error: {}", e))
}

pub fn ensure_global_settings(conn: &Connection) -> Result<GlobalSettings, String> {
    let existing = db::get_setting(conn, GLOBAL_SETTINGS_KEY)
        .map_err(|e| format!("Database error: {}", e))?;

    if let Some(json) = existing {
        return serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse global settings: {}", e));
    }

    let defaults = GlobalSettings::default();
    save_global_settings(conn, &defaults)?;
    Ok(defaults)
}
