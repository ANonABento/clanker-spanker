use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

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
                for line_result in reader.lines() {
                    if let Ok(line) = line_result {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_registry_new() {
        let registry = ProcessRegistry::new();
        assert!(!registry.is_running("nonexistent"));
    }
}
