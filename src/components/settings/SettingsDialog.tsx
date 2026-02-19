import { useEffect, useMemo, useState } from "react";
import { X, Sun, Moon, Power, Keyboard, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useAutostart } from "@/hooks/useAutostart";
import { getGlobalSettings, setGlobalSettings } from "@/lib/tauri";
import type { GlobalSettings, ScheduleSettings, NotificationSettings } from "@/lib/types";
import type { Theme } from "@/lib/theme";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function SettingsDialog({
  isOpen,
  onClose,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  const { isAutoStartEnabled, isLoading: isAutoStartLoading, toggleAutoStart } = useAutostart();
  const [sleepPreventionEnabled, setSleepPreventionEnabled] = useState(false);
  const [sleepPreventionLoading, setSleepPreventionLoading] = useState(false);
  const [globalSettings, setGlobalSettingsState] = useState<GlobalSettings | null>(null);
  const [globalSettingsDraft, setGlobalSettingsDraft] = useState<GlobalSettings | null>(null);
  const [globalSettingsLoading, setGlobalSettingsLoading] = useState(false);
  const [globalSettingsSaving, setGlobalSettingsSaving] = useState(false);

  // Load sleep prevention setting
  useEffect(() => {
    if (!isOpen) return;
    invoke<string | null>("get_setting", { key: "sleep_prevention_enabled" })
      .then((value) => setSleepPreventionEnabled(value === "true"))
      .catch(console.error);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setGlobalSettingsLoading(true);
    getGlobalSettings()
      .then((settings) => {
        const cloned = JSON.parse(JSON.stringify(settings)) as GlobalSettings;
        setGlobalSettingsState(settings);
        setGlobalSettingsDraft(cloned);
      })
      .catch((error) => {
        console.error("Failed to load global settings:", error);
      })
      .finally(() => setGlobalSettingsLoading(false));
  }, [isOpen]);

  const toggleSleepPrevention = async () => {
    setSleepPreventionLoading(true);
    try {
      const newValue = !sleepPreventionEnabled;
      await invoke("set_setting", {
        key: "sleep_prevention_enabled",
        value: newValue ? "true" : "false",
      });
      setSleepPreventionEnabled(newValue);
      // Sync sleep state with current monitors
      await invoke("sync_sleep_prevention");
    } catch (error) {
      console.error("Failed to toggle sleep prevention:", error);
    } finally {
      setSleepPreventionLoading(false);
    }
  };

  const updateDraft = (updates: Partial<GlobalSettings>) => {
    setGlobalSettingsDraft((current) => {
      if (!current) return current;
      return { ...current, ...updates };
    });
  };

  const updateSchedule = (updates: Partial<ScheduleSettings>) => {
    setGlobalSettingsDraft((current) => {
      if (!current) return current;
      return { ...current, schedule: { ...current.schedule, ...updates } };
    });
  };

  const updateNotifications = (updates: Partial<NotificationSettings>) => {
    setGlobalSettingsDraft((current) => {
      if (!current) return current;
      return { ...current, notifications: { ...current.notifications, ...updates } };
    });
  };

  const dayOptions = useMemo(
    () => [
      { id: "mon", label: "Mon" },
      { id: "tue", label: "Tue" },
      { id: "wed", label: "Wed" },
      { id: "thu", label: "Thu" },
      { id: "fri", label: "Fri" },
      { id: "sat", label: "Sat" },
      { id: "sun", label: "Sun" },
    ],
    []
  );

  const isDirty = useMemo(() => {
    if (!globalSettings || !globalSettingsDraft) return false;
    return JSON.stringify(globalSettings) !== JSON.stringify(globalSettingsDraft);
  }, [globalSettings, globalSettingsDraft]);

  const saveGlobalSettings = async () => {
    if (!globalSettingsDraft) return;
    setGlobalSettingsSaving(true);
    try {
      const saved = await setGlobalSettings(globalSettingsDraft);
      const cloned = JSON.parse(JSON.stringify(saved)) as GlobalSettings;
      setGlobalSettingsState(saved);
      setGlobalSettingsDraft(cloned);
    } catch (error) {
      console.error("Failed to save global settings:", error);
    } finally {
      setGlobalSettingsSaving(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-surface border border-border rounded-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Close settings"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {/* Appearance Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Appearance
            </h3>
            <div className="flex gap-2">
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => onThemeChange("dark")}
                className="flex-1"
              >
                <Moon className="h-4 w-4 mr-2" />
                Dark
              </Button>
              <Button
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => onThemeChange("light")}
                className="flex-1"
              >
                <Sun className="h-4 w-4 mr-2" />
                Light
              </Button>
            </div>
          </section>

          {/* Startup Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Startup
            </h3>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Power className="h-4 w-4 text-text-secondary" />
                <div>
                  <p className="text-sm text-text-primary">Start on login</p>
                  <p className="text-xs text-text-tertiary">
                    Launch automatically when you log in
                  </p>
                </div>
              </div>
              <Button
                variant={isAutoStartEnabled ? "default" : "outline"}
                size="sm"
                onClick={toggleAutoStart}
                disabled={isAutoStartLoading}
              >
                {isAutoStartEnabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
          </section>

          {/* Power Management Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Power
            </h3>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-text-secondary" />
                <div>
                  <p className="text-sm text-text-primary">Prevent sleep while monitoring</p>
                  <p className="text-xs text-text-tertiary">
                    Keep your computer awake when monitors are active
                  </p>
                </div>
              </div>
              <Button
                variant={sleepPreventionEnabled ? "default" : "outline"}
                size="sm"
                onClick={toggleSleepPrevention}
                disabled={sleepPreventionLoading}
              >
                {sleepPreventionEnabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
          </section>

          {/* Automation Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Automation
            </h3>
            {globalSettingsLoading || !globalSettingsDraft ? (
              <div className="text-sm text-text-secondary">Loading settings...</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                      Runner
                    </label>
                    <select
                      value={globalSettingsDraft.runner}
                      onChange={(e) =>
                        updateDraft({
                          runner: e.target.value as GlobalSettings["runner"],
                        })
                      }
                      className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                    >
                      <option value="auto">Auto</option>
                      <option value="codex">Codex</option>
                      <option value="claude">Claude</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                      Steps
                    </label>
                    <select
                      value={globalSettingsDraft.steps}
                      onChange={(e) =>
                        updateDraft({
                          steps: e.target.value as GlobalSettings["steps"],
                        })
                      }
                      className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                    >
                      <option value="both">CI + Comments</option>
                      <option value="ci">CI only</option>
                      <option value="comments">Comments only</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    PR scope
                  </label>
                  <select
                    value={globalSettingsDraft.prScope}
                    onChange={(e) =>
                      updateDraft({
                        prScope: e.target.value as GlobalSettings["prScope"],
                      })
                    }
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  >
                    <option value="all">All open PRs</option>
                    <option value="involved">Only PRs involving me</option>
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                  <div>
                    <p className="text-sm text-text-primary">
                      Auto-start on Draft → Open
                    </p>
                    <p className="text-xs text-text-tertiary">
                      Automatically enqueue when a draft PR opens
                    </p>
                  </div>
                  <Button
                    variant={globalSettingsDraft.autoStartDraftToOpen ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      updateDraft({
                        autoStartDraftToOpen: !globalSettingsDraft.autoStartDraftToOpen,
                      })
                    }
                  >
                    {globalSettingsDraft.autoStartDraftToOpen ? "Enabled" : "Disabled"}
                  </Button>
                </div>

                <div className="rounded-lg border border-border bg-surface-secondary p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-text-primary">Schedule</p>
                      <p className="text-xs text-text-tertiary">
                        Run automation on a schedule
                      </p>
                    </div>
                    <Button
                      variant={globalSettingsDraft.schedule.enabled ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        updateSchedule({
                          enabled: !globalSettingsDraft.schedule.enabled,
                        })
                      }
                    >
                      {globalSettingsDraft.schedule.enabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dayOptions.map((day) => {
                      const active = globalSettingsDraft.schedule.days.includes(day.id);
                      return (
                        <Button
                          key={day.id}
                          variant={active ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            const nextDays = active
                              ? globalSettingsDraft.schedule.days.filter((d) => d !== day.id)
                              : [...globalSettingsDraft.schedule.days, day.id];
                            updateSchedule({ days: nextDays });
                          }}
                        >
                          {day.label}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                        Time
                      </label>
                      <input
                        type="time"
                        value={globalSettingsDraft.schedule.time}
                        onChange={(e) => updateSchedule({ time: e.target.value })}
                        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                        Timezone
                      </label>
                      <input
                        type="text"
                        value={globalSettingsDraft.schedule.timezone}
                        onChange={(e) => updateSchedule({ timezone: e.target.value })}
                        placeholder="local or e.g. America/Los_Angeles"
                        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Limits Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Limits
            </h3>
            {!globalSettingsDraft ? (
              <div className="text-sm text-text-secondary">Loading settings...</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    Iterations
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={globalSettingsDraft.defaultIterations}
                    onChange={(e) =>
                      updateDraft({ defaultIterations: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    Interval (minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={globalSettingsDraft.intervalMinutes}
                    onChange={(e) =>
                      updateDraft({ intervalMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    Concurrency cap
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={globalSettingsDraft.concurrencyCap}
                    onChange={(e) =>
                      updateDraft({ concurrencyCap: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    Max jobs per night
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={globalSettingsDraft.maxJobsPerNight}
                    onChange={(e) =>
                      updateDraft({ maxJobsPerNight: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    Pending wait (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={globalSettingsDraft.pendingWaitMinutes}
                    onChange={(e) =>
                      updateDraft({ pendingWaitMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Push + Notifications Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Push & Notifications
            </h3>
            {!globalSettingsDraft ? (
              <div className="text-sm text-text-secondary">Loading settings...</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                  <div>
                    <p className="text-sm text-text-primary">Push changes</p>
                    <p className="text-xs text-text-tertiary">
                      Allow runners to commit and push fixes
                    </p>
                  </div>
                  <Button
                    variant={globalSettingsDraft.pushEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      updateDraft({ pushEnabled: !globalSettingsDraft.pushEnabled })
                    }
                  >
                    {globalSettingsDraft.pushEnabled ? "Enabled" : "Disabled"}
                  </Button>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                    Commit message template
                  </label>
                  <input
                    type="text"
                    value={globalSettingsDraft.commitMessageTemplate}
                    onChange={(e) =>
                      updateDraft({ commitMessageTemplate: e.target.value })
                    }
                    placeholder="Fix PR #{{prNumber}} feedback"
                    className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-sm text-text-primary focus:border-[#505050] focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={globalSettingsDraft.notifications.onStart ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      updateNotifications({
                        onStart: !globalSettingsDraft.notifications.onStart,
                      })
                    }
                  >
                    Notify start
                  </Button>
                  <Button
                    variant={globalSettingsDraft.notifications.onComplete ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      updateNotifications({
                        onComplete: !globalSettingsDraft.notifications.onComplete,
                      })
                    }
                  >
                    Notify complete
                  </Button>
                  <Button
                    variant={globalSettingsDraft.notifications.onFailure ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      updateNotifications({
                        onFailure: !globalSettingsDraft.notifications.onFailure,
                      })
                    }
                  >
                    Notify failure
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Shortcuts Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Keyboard Shortcuts
            </h3>
            <div className="p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Keyboard className="h-4 w-4 text-text-secondary" />
                <div>
                  <p className="text-sm text-text-primary">Global toggle</p>
                  <p className="text-xs text-text-tertiary">
                    Show/hide window from anywhere
                  </p>
                </div>
                <kbd className="ml-auto px-2 py-1 text-xs font-mono bg-surface border border-border rounded">
                  Cmd+Shift+P
                </kbd>
              </div>
            </div>
          </section>

          {/* Save Section */}
          <section className="flex justify-end">
            <Button
              size="sm"
              onClick={saveGlobalSettings}
              disabled={!isDirty || globalSettingsSaving || globalSettingsLoading}
            >
              {globalSettingsSaving ? "Saving..." : "Save settings"}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
