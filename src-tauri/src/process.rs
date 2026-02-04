use crate::db::{self, AppState};
use crate::sleep_prevention;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event payload for terminal output
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorOutputPayload {
    pub monitor_id: String,
    pub pr_id: String,
    pub line: String,
}

/// Registry for tracking spawned monitor processes
pub struct ProcessRegistry {
    processes: Mutex<HashMap<String, Child>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a monitor process and stream its output via Tauri events
    pub fn spawn_monitor<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        monitor_id: &str,
        pr_id: &str,
        pr_number: i32,
        repo: &str,
        max_iterations: i32,
        interval_minutes: i32,
    ) -> Result<u32, String> {
        // Get the scripts directory path using dirs crate
        let app_data_dir = dirs::data_local_dir()
            .ok_or_else(|| "Failed to get local data directory".to_string())?
            .join("com.clanker-spanker.app");

        let scripts_dir = app_data_dir.join("scripts");
        let script_path = scripts_dir.join("monitor-pr-loop.sh");

        // Ensure scripts directory exists and script is installed
        std::fs::create_dir_all(&scripts_dir)
            .map_err(|e| format!("Failed to create scripts directory: {}", e))?;

        // Always write the embedded script (to update if changed)
        let script_content = include_str!("../scripts/monitor-pr-loop.sh");
        std::fs::write(&script_path, script_content)
            .map_err(|e| format!("Failed to write script: {}", e))?;

        // Make script executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path)
                .map_err(|e| format!("Failed to get script metadata: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms)
                .map_err(|e| format!("Failed to set script permissions: {}", e))?;
        }

        // Spawn the monitor script
        let mut child = Command::new("bash")
            .arg(&script_path)
            .arg(pr_number.to_string())
            .arg(repo)
            .arg(max_iterations.to_string())
            .arg(interval_minutes.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn process: {}", e))?;

        let pid = child.id();

        // Take stdout and stderr handles
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Store the child process
        {
            let mut processes = self
                .processes
                .lock()
                .map_err(|e| format!("Failed to lock process registry: {}", e))?;
            processes.insert(monitor_id.to_string(), child);
        }

        // Spawn thread to read stdout and emit events
        if let Some(stdout) = stdout {
            let app_handle = app.clone();
            let monitor_id_clone = monitor_id.to_string();
            let pr_id_clone = pr_id.to_string();

            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                let mut last_status_line = String::new();

                for line_result in reader.lines() {
                    if let Ok(line) = line_result {
                        // Track status lines for exit reason
                        if line.contains("@@STATUS:") {
                            last_status_line = line.clone();
                        }

                        // Parse iteration markers to update database progress
                        if line.starts_with("@@ITERATION:") && line.ends_with("@@") {
                            let inner = &line[12..line.len() - 2]; // strip @@ITERATION: and @@
                            if let Some((iter_str, max_str)) = inner.split_once('/') {
                                if let (Ok(iter), Ok(_max)) = (iter_str.parse::<i32>(), max_str.parse::<i32>()) {
                                    if let Some(state) = app_handle.try_state::<AppState>() {
                                        if let Ok(conn) = state.db.lock() {
                                            let now = chrono::Utc::now().to_rfc3339();
                                            let _ = conn.execute(
                                                "UPDATE monitors SET iteration = ?1, last_check_at = ?2 WHERE id = ?3",
                                                rusqlite::params![iter, now, monitor_id_clone],
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        let _ = app_handle.emit(
                            "monitor:output",
                            MonitorOutputPayload {
                                monitor_id: monitor_id_clone.clone(),
                                pr_id: pr_id_clone.clone(),
                                line,
                            },
                        );
                    }
                }

                // Process has exited - update database and sleep state
                handle_process_exit(&app_handle, &monitor_id_clone, &pr_id_clone, &last_status_line);
            });
        }

        // Spawn thread to read stderr and emit as output too
        if let Some(stderr) = stderr {
            let app_handle = app.clone();
            let monitor_id_clone = monitor_id.to_string();
            let pr_id_clone = pr_id.to_string();

            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line_result in reader.lines() {
                    if let Ok(line) = line_result {
                        let _ = app_handle.emit(
                            "monitor:output",
                            MonitorOutputPayload {
                                monitor_id: monitor_id_clone.clone(),
                                pr_id: pr_id_clone.clone(),
                                line: format!("[stderr] {}", line),
                            },
                        );
                    }
                }
            });
        }

        Ok(pid)
    }

    /// Kill a process by monitor ID
    pub fn kill(&self, monitor_id: &str) -> Result<(), String> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| format!("Failed to lock process registry: {}", e))?;

        if let Some(mut child) = processes.remove(monitor_id) {
            child
                .kill()
                .map_err(|e| format!("Failed to kill process: {}", e))?;
            // Wait for process to clean up
            let _ = child.wait();
        }

        Ok(())
    }

    /// Kill all running processes (for app shutdown)
    pub fn kill_all(&self) {
        if let Ok(mut processes) = self.processes.lock() {
            for (_, mut child) in processes.drain() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Check if a process is still running
    pub fn is_running(&self, monitor_id: &str) -> bool {
        if let Ok(mut processes) = self.processes.lock() {
            if let Some(child) = processes.get_mut(monitor_id) {
                // try_wait returns Ok(None) if process is still running
                return matches!(child.try_wait(), Ok(None));
            }
        }
        false
    }

    /// Get the PID for a monitor
    pub fn get_pid(&self, monitor_id: &str) -> Option<u32> {
        if let Ok(processes) = self.processes.lock() {
            if let Some(child) = processes.get(monitor_id) {
                return Some(child.id());
            }
        }
        None
    }

    /// Clean up finished processes
    pub fn cleanup_finished(&self) -> Vec<String> {
        let mut finished = Vec::new();

        if let Ok(mut processes) = self.processes.lock() {
            let mut to_remove = Vec::new();

            for (id, child) in processes.iter_mut() {
                // Check if process has exited
                if let Ok(Some(_status)) = child.try_wait() {
                    to_remove.push(id.clone());
                }
            }

            for id in to_remove {
                processes.remove(&id);
                finished.push(id);
            }
        }

        finished
    }
}

impl Default for ProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle monitor process exit - update database and sleep state
fn handle_process_exit<R: Runtime>(app: &AppHandle<R>, monitor_id: &str, pr_id: &str, last_status_line: &str) {
    // Determine exit reason from the last status line
    let exit_reason = if last_status_line.contains("@@STATUS:clean@@") {
        "pr_clean"
    } else if last_status_line.contains("@@STATUS:max_iterations@@") {
        "max_iterations"
    } else {
        "process_exited"
    };

    let status = if exit_reason == "pr_clean" {
        "completed"
    } else {
        "failed"
    };

    let mut pr_number: Option<i32> = None;
    let mut iteration: i32 = 0;
    let mut max_iterations: i32 = 0;

    // Update database
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(conn) = state.db.lock() {
            // Get pr_number, iteration, max_iterations from database
            if let Ok((num, iter, max_iter)) = conn.query_row(
                "SELECT pr_number, iteration, max_iterations FROM monitors WHERE id = ?1",
                [monitor_id],
                |row| Ok((row.get::<_, i32>(0)?, row.get::<_, i32>(1)?, row.get::<_, i32>(2)?)),
            ) {
                pr_number = Some(num);
                iteration = iter;
                max_iterations = max_iter;
            }

            let now = chrono::Utc::now().to_rfc3339();
            let _ = conn.execute(
                "UPDATE monitors SET status = ?1, ended_at = ?2, exit_reason = ?3 WHERE id = ?4 AND status IN ('running', 'sleeping')",
                rusqlite::params![status, now, exit_reason, monitor_id],
            );

            // Update sleep prevention state
            let sleep_enabled = db::get_setting_value(&conn, "sleep_prevention_enabled")
                .map(|v| v == "true")
                .unwrap_or(false);

            let count: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM monitors WHERE status IN ('running', 'sleeping')",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            sleep_prevention::update_sleep_state(count, sleep_enabled);

            // Update tray and dock
            crate::tray::update_tray_status(count);
            crate::dock::set_dock_badge(if count > 0 { Some(count) } else { None });
        }

        // Emit state change event
        let _ = app.emit(
            "monitor:state-changed",
            crate::monitor::MonitorStatePayload {
                active_count: crate::monitor::get_active_monitor_count(&state).unwrap_or(0),
            },
        );

        // Emit completion event for frontend (with prId passed directly)
        let _ = app.emit("monitor:completed", serde_json::json!({
            "monitorId": monitor_id,
            "prId": pr_id,
            "prNumber": pr_number,
            "exitReason": exit_reason,
            "status": status,
            "iteration": iteration,
            "maxIterations": max_iterations,
        }));
    }

    println!("Monitor {} exited: {} ({})", monitor_id, status, exit_reason);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_registry_new() {
        let registry = ProcessRegistry::new();
        assert!(!registry.is_running("nonexistent"));
    }
}
