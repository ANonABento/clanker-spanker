use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Payload for notification events
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    pub notification_type: String,
    pub pr_id: String,
    pub pr_number: i32,
}

#[tauri::command]
pub fn notify_pr_clean(app: AppHandle, pr_number: i32, pr_id: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title("PR is clean!")
        .body(format!("PR #{} has no unresolved comments", pr_number))
        .show()
        .map_err(|e| e.to_string())?;

    // Emit event for frontend tracking
    let _ = app.emit(
        "notification:shown",
        NotificationPayload {
            notification_type: "pr_clean".to_string(),
            pr_id,
            pr_number,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn notify_comment_found(
    app: AppHandle,
    pr_number: i32,
    pr_id: String,
    count: i32,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Comments found")
        .body(format!("PR #{} has {} unresolved comments", pr_number, count))
        .show()
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "notification:shown",
        NotificationPayload {
            notification_type: "comment_found".to_string(),
            pr_id,
            pr_number,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn notify_monitor_complete(
    app: AppHandle,
    pr_number: i32,
    pr_id: String,
    comments_fixed: i32,
) -> Result<(), String> {
    let body = if comments_fixed > 0 {
        format!(
            "PR #{} complete - {} comments fixed",
            pr_number, comments_fixed
        )
    } else {
        format!("PR #{} monitoring complete", pr_number)
    };

    app.notification()
        .builder()
        .title("Monitor Complete")
        .body(body)
        .show()
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "notification:shown",
        NotificationPayload {
            notification_type: "monitor_complete".to_string(),
            pr_id,
            pr_number,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn notify_monitor_failed(
    app: AppHandle,
    pr_number: i32,
    pr_id: String,
    reason: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Monitor Failed")
        .body(format!("PR #{}: {}", pr_number, reason))
        .show()
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "notification:shown",
        NotificationPayload {
            notification_type: "monitor_failed".to_string(),
            pr_id,
            pr_number,
        },
    );

    Ok(())
}

/// Show window and emit event to focus a specific PR
#[tauri::command]
pub fn show_and_focus_pr(app: AppHandle, pr_id: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    // Emit event for frontend to scroll to/highlight the PR
    let _ = app.emit("pr:focus", pr_id);

    Ok(())
}
