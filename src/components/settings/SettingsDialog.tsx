import { useEffect, useState } from "react";
import { X, Sun, Moon, Power, Keyboard, Zap, Bot, ShieldAlert } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useAutostart } from "@/hooks/useAutostart";
import type { Theme } from "@/lib/theme";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

interface EffectiveAiModel {
  provider: string;
  model: string;
  source: "override" | "provider_default" | "unknown";
}

export function SettingsDialog({
  isOpen,
  onClose,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  const AI_PROVIDER_KEY = "ai_provider";
  const AI_MODEL_CLAUDE_KEY = "ai_model_claude";
  const AI_MODEL_CODEX_KEY = "ai_model_codex";
  const MONITOR_DIRTY_WORKTREE_POLICY_KEY = "monitor_dirty_worktree_policy";
  const SKIP_CI_FIX_KEY = "skip_ci_fix";

  const { isAutoStartEnabled, isLoading: isAutoStartLoading, toggleAutoStart } = useAutostart();
  const [sleepPreventionEnabled, setSleepPreventionEnabled] = useState(false);
  const [sleepPreventionLoading, setSleepPreventionLoading] = useState(false);
  const [aiProvider, setAiProvider] = useState<"claude" | "codex">("claude");
  const [aiModel, setAiModel] = useState("");
  const [savedAiProvider, setSavedAiProvider] = useState<"claude" | "codex">("claude");
  const [savedAiModel, setSavedAiModel] = useState("");
  const [effectiveAiModel, setEffectiveAiModel] = useState<EffectiveAiModel | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [autoStashDirtyWorkspace, setAutoStashDirtyWorkspace] = useState(false);
  const [workspacePolicyLoading, setWorkspacePolicyLoading] = useState(false);
  const [skipCiFix, setSkipCiFix] = useState(false);
  const [skipCiFixLoading, setSkipCiFixLoading] = useState(false);

  const getModelKey = (provider: "claude" | "codex") =>
    provider === "codex" ? AI_MODEL_CODEX_KEY : AI_MODEL_CLAUDE_KEY;

  const loadEffectiveAiModel = async () => {
    try {
      const result = await invoke<EffectiveAiModel>("get_effective_ai_model");
      setEffectiveAiModel(result);
    } catch (error) {
      console.error("Failed to load effective AI model:", error);
      setEffectiveAiModel(null);
    }
  };

  // Load sleep prevention setting
  useEffect(() => {
    if (!isOpen) return;
    invoke<string | null>("get_setting", { key: "sleep_prevention_enabled" })
      .then((value) => setSleepPreventionEnabled(value === "true"))
      .catch(console.error);
  }, [isOpen]);

  // Load AI settings
  useEffect(() => {
    if (!isOpen) return;

    const loadAISettings = async () => {
      setAiLoading(true);
      try {
        const providerRaw = await invoke<string | null>("get_setting", {
          key: AI_PROVIDER_KEY,
        });
        const provider: "claude" | "codex" = providerRaw === "codex" ? "codex" : "claude";
        setAiProvider(provider);
        setSavedAiProvider(provider);

        const modelRaw = await invoke<string | null>("get_setting", {
          key: getModelKey(provider),
        });
        const model = modelRaw ?? "";
        setAiModel(model);
        setSavedAiModel(model);
        await loadEffectiveAiModel();
      } catch (error) {
        console.error("Failed to load AI settings:", error);
      } finally {
        setAiLoading(false);
      }
    };

    loadAISettings();
  }, [isOpen]);

  // Load monitor workspace policy setting
  useEffect(() => {
    if (!isOpen) return;
    setWorkspacePolicyLoading(true);
    invoke<string | null>("get_setting", { key: MONITOR_DIRTY_WORKTREE_POLICY_KEY })
      .then((value) => setAutoStashDirtyWorkspace((value ?? "abort") === "stash"))
      .catch((error) => {
        console.error("Failed to load monitor workspace policy:", error);
      })
      .finally(() => setWorkspacePolicyLoading(false));
  }, [isOpen]);

  // Load skip CI fix setting
  useEffect(() => {
    if (!isOpen) return;
    setSkipCiFixLoading(true);
    invoke<string | null>("get_setting", { key: SKIP_CI_FIX_KEY })
      .then((value) => setSkipCiFix(value === "true"))
      .catch((error) => {
        console.error("Failed to load skip CI fix setting:", error);
      })
      .finally(() => setSkipCiFixLoading(false));
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

  const handleAIProviderChange = async (provider: "claude" | "codex") => {
    setAiSaving(true);
    try {
      await invoke("set_setting", { key: AI_PROVIDER_KEY, value: provider });

      // Load model for the selected provider so users can keep distinct defaults.
      const modelRaw = await invoke<string | null>("get_setting", {
        key: getModelKey(provider),
      });
      const model = modelRaw ?? "";
      setAiProvider(provider);
      setSavedAiProvider(provider);
      setAiModel(model);
      setSavedAiModel(model);
      await loadEffectiveAiModel();
    } catch (error) {
      console.error("Failed to update AI provider:", error);
    } finally {
      setAiSaving(false);
    }
  };

  const saveAIModel = async () => {
    setAiSaving(true);
    try {
      const normalizedModel = aiModel.trim();
      await invoke("set_setting", {
        key: getModelKey(aiProvider),
        value: normalizedModel,
      });
      setAiModel(normalizedModel);
      setSavedAiModel(normalizedModel);
      await loadEffectiveAiModel();
    } catch (error) {
      console.error("Failed to save AI model:", error);
    } finally {
      setAiSaving(false);
    }
  };

  const toggleAutoStashDirtyWorkspace = async () => {
    setWorkspacePolicyLoading(true);
    try {
      const nextValue = !autoStashDirtyWorkspace;
      await invoke("set_setting", {
        key: MONITOR_DIRTY_WORKTREE_POLICY_KEY,
        value: nextValue ? "stash" : "abort",
      });
      setAutoStashDirtyWorkspace(nextValue);
    } catch (error) {
      console.error("Failed to save monitor workspace policy:", error);
    } finally {
      setWorkspacePolicyLoading(false);
    }
  };

  const toggleSkipCiFix = async () => {
    setSkipCiFixLoading(true);
    try {
      const nextValue = !skipCiFix;
      await invoke("set_setting", {
        key: SKIP_CI_FIX_KEY,
        value: nextValue ? "true" : "false",
      });
      setSkipCiFix(nextValue);
    } catch (error) {
      console.error("Failed to save skip CI fix setting:", error);
    } finally {
      setSkipCiFixLoading(false);
    }
  };

  const hasUnsavedModelChanges = aiModel.trim() !== savedAiModel;
  const currentProviderLabel = effectiveAiModel
    ? effectiveAiModel.provider === "codex"
      ? "Codex"
      : "Claude"
    : savedAiProvider === "codex"
      ? "Codex"
      : "Claude";
  const currentModelLabel = effectiveAiModel?.model ?? "Unknown";
  const currentModelSourceLabel = effectiveAiModel?.source === "override"
    ? "saved in app settings"
    : effectiveAiModel?.source === "provider_default"
      ? effectiveAiModel?.provider === "codex"
        ? "from ~/.codex/config.toml"
        : "from ~/.claude/settings.json"
      : "not detected";

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
      <div className="relative bg-surface border border-border rounded-lg w-full max-w-md p-6 shadow-lg animate-in fade-in zoom-in-95 duration-200">
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

          {/* AI Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              AI
            </h3>
            <div className="space-y-3 p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Bot className="h-4 w-4 text-text-secondary" />
                <div className="flex-1">
                  <p className="text-sm text-text-primary">Provider</p>
                  <p className="text-xs text-text-tertiary">
                    Select the CLI used for monitor automation
                  </p>
                </div>
                <select
                  value={aiProvider}
                  onChange={(e) => handleAIProviderChange(e.target.value as "claude" | "codex")}
                  disabled={aiLoading || aiSaving}
                  className="px-2 py-1.5 text-sm rounded-md bg-surface border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-border"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder={
                    aiProvider === "codex"
                      ? "Model (optional, e.g. gpt-5)"
                      : "Model (optional, e.g. sonnet)"
                  }
                  disabled={aiLoading || aiSaving}
                  className="flex-1 px-3 py-1.5 text-sm rounded-md bg-surface border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveAIModel}
                  disabled={aiLoading || aiSaving}
                >
                  Save
                </Button>
              </div>

              <div className="rounded-md border border-border bg-surface p-2">
                <p className="text-xs text-text-tertiary">Currently used for new monitors</p>
                <p className="text-sm text-text-primary">
                  Provider: <span className="font-medium">{currentProviderLabel}</span>
                </p>
                <p className="text-sm text-text-primary">
                  Model: <span className="font-medium">{currentModelLabel}</span>{" "}
                  <span className="text-xs text-text-tertiary">({currentModelSourceLabel})</span>
                </p>
                {hasUnsavedModelChanges && (
                  <p className="text-xs text-text-tertiary">
                    Model edits apply after clicking Save.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-md border border-border bg-surface p-2">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="h-4 w-4 text-text-secondary" />
                  <div>
                    <p className="text-sm text-text-primary">Auto-stash dirty workspace</p>
                    <p className="text-xs text-text-tertiary">
                      If disabled, monitors stop when git state changes unexpectedly.
                    </p>
                  </div>
                </div>
                <Button
                  variant={autoStashDirtyWorkspace ? "default" : "outline"}
                  size="sm"
                  onClick={toggleAutoStashDirtyWorkspace}
                  disabled={workspacePolicyLoading}
                >
                  {autoStashDirtyWorkspace ? "Stash" : "Abort"}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="h-4 w-4 text-text-secondary" />
                  <div>
                    <p className="text-sm text-text-primary">CI failure handling</p>
                    <p className="text-xs text-text-tertiary">
                      {skipCiFix
                        ? "Currently ignoring CI failures"
                        : "Will attempt to fix CI failures"}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleSkipCiFix}
                  disabled={skipCiFixLoading}
                  className={skipCiFix ? "text-yellow-500 border-yellow-500/50" : ""}
                >
                  {skipCiFix ? "Ignoring CI" : "Fixing CI"}
                </Button>
              </div>
            </div>
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
        </div>
      </div>
    </div>
  );
}
