import { useEffect, useState, useMemo } from "react";
import { X, Sun, Moon, Power, Check, AlertCircle, Brain, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAutostart } from "@/hooks/useAutostart";
import { getGlobalSettings, setGlobalSettings, detectRunners } from "@/lib/tauri";
import type { GlobalSettings, AvailableRunners, ModelInfo, FixSettings } from "@/lib/types";
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
  const [globalSettings, setGlobalSettingsState] = useState<GlobalSettings | null>(null);
  const [runners, setRunners] = useState<AvailableRunners | null>(null);
  const [runner, setRunner] = useState<GlobalSettings["runner"]>("auto");
  const [claudeModel, setClaudeModel] = useState<string>("sonnet");
  const [codexModel, setCodexModel] = useState<string>("gpt-5.4");
  const [thinkingLevel, setThinkingLevel] = useState<string>("medium");
  const [fix, setFix] = useState<FixSettings>({ ci: true, comments: true, conflicts: false });
  const [pushEnabled, setPushEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Detect available runners on mount
  useEffect(() => {
    if (!isOpen) return;
    detectRunners()
      .then(setRunners)
      .catch(console.error);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    getGlobalSettings()
      .then((settings) => {
        setGlobalSettingsState(settings);
        setRunner(settings.runner);
        setClaudeModel(settings.claudeModel || "sonnet");
        setCodexModel(settings.codexModel || "gpt-5.4");
        setThinkingLevel(settings.thinkingLevel || "medium");
        setFix(settings.fix || { ci: true, comments: true, conflicts: false });
        setPushEnabled(settings.pushEnabled);
        setIsDirty(false);
      })
      .catch(console.error);
  }, [isOpen]);

  // Get current model info based on selected runner and model
  const currentModelInfo = useMemo((): ModelInfo | null => {
    if (runner === "claude" && runners?.claude) {
      return runners.claude.models.find((m) => m.slug === claudeModel) || null;
    }
    if (runner === "codex" && runners?.codex) {
      return runners.codex.models.find((m) => m.slug === codexModel) || null;
    }
    return null;
  }, [runner, claudeModel, codexModel, runners]);

  // Get available thinking levels for current model
  const availableThinkingLevels = useMemo(() => {
    return currentModelInfo?.supportedReasoningLevels || [];
  }, [currentModelInfo]);

  // Reset thinking level when model changes if current level is not supported
  useEffect(() => {
    if (availableThinkingLevels.length > 0) {
      const isCurrentSupported = availableThinkingLevels.some((l) => l.effort === thinkingLevel);
      if (!isCurrentSupported) {
        const defaultLevel = currentModelInfo?.defaultReasoningLevel || "medium";
        setThinkingLevel(defaultLevel);
        setIsDirty(true);
      }
    }
  }, [availableThinkingLevels, currentModelInfo, thinkingLevel]);

  const handleRunnerChange = (value: GlobalSettings["runner"]) => {
    setRunner(value);
    setIsDirty(true);
  };

  const handleClaudeModelChange = (value: string) => {
    setClaudeModel(value);
    setIsDirty(true);
  };

  const handleCodexModelChange = (value: string) => {
    setCodexModel(value);
    setIsDirty(true);
  };

  const handleThinkingLevelChange = (value: string) => {
    setThinkingLevel(value);
    setIsDirty(true);
  };

  const handleFixToggle = (key: keyof FixSettings) => {
    setFix((prev) => ({ ...prev, [key]: !prev[key] }));
    setIsDirty(true);
  };

  const handlePushChange = () => {
    setPushEnabled(!pushEnabled);
    setIsDirty(true);
  };

  const save = async () => {
    if (!globalSettings) return;
    setSaving(true);
    try {
      const updated = {
        ...globalSettings,
        runner,
        claudeModel: claudeModel as GlobalSettings["claudeModel"],
        codexModel: codexModel as GlobalSettings["codexModel"],
        thinkingLevel,
        fix,
        pushEnabled,
      };
      await setGlobalSettings(updated);
      setGlobalSettingsState(updated);
      setIsDirty(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const claudeAvailable = runners?.claude?.available ?? false;
  const codexAvailable = runners?.codex?.available ?? false;
  const claudeModels = runners?.claude?.models ?? [];
  const codexModels = runners?.codex?.models ?? [];

  // Helper to format model name for display (truncate long names)
  const formatModelName = (model: ModelInfo) => {
    const name = model.displayName || model.slug;
    // For buttons, truncate if too long
    if (name.length > 12) {
      return name.replace("gpt-", "").replace("-codex", "");
    }
    return name;
  };

  // Determine if we should use dropdown vs buttons
  const useDropdownForClaude = claudeModels.length > 4;
  const useDropdownForCodex = codexModels.length > 4 || codexModels.some((m) => m.slug.length > 10);

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
        <div className="space-y-5">
          {/* Theme */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-2">
              Theme
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

          {/* Startup */}
          <section>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Power className="h-4 w-4 text-text-secondary" />
                <p className="text-sm text-text-primary">Start on login</p>
              </div>
              <Button
                variant={isAutoStartEnabled ? "default" : "outline"}
                size="sm"
                onClick={toggleAutoStart}
                disabled={isAutoStartLoading}
              >
                {isAutoStartEnabled ? "On" : "Off"}
              </Button>
            </div>
          </section>

          {/* Runner */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-2">
              Runner
            </h3>
            <div className="flex gap-2">
              <Button
                variant={runner === "auto" ? "default" : "outline"}
                size="sm"
                onClick={() => handleRunnerChange("auto")}
                className="flex-1"
              >
                Auto
              </Button>
              <Button
                variant={runner === "claude" ? "default" : "outline"}
                size="sm"
                onClick={() => handleRunnerChange("claude")}
                className="flex-1 relative"
                disabled={!claudeAvailable}
              >
                Claude
                {claudeAvailable ? (
                  <Check className="h-3 w-3 ml-1 text-green-500" />
                ) : (
                  <AlertCircle className="h-3 w-3 ml-1 text-text-tertiary" />
                )}
              </Button>
              <Button
                variant={runner === "codex" ? "default" : "outline"}
                size="sm"
                onClick={() => handleRunnerChange("codex")}
                className="flex-1 relative"
                disabled={!codexAvailable}
              >
                Codex
                {codexAvailable ? (
                  <Check className="h-3 w-3 ml-1 text-green-500" />
                ) : (
                  <AlertCircle className="h-3 w-3 ml-1 text-text-tertiary" />
                )}
              </Button>
            </div>
          </section>

          {/* Claude Model */}
          {runner === "claude" && claudeAvailable && claudeModels.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-2">
                Claude Model
              </h3>
              {useDropdownForClaude ? (
                <select
                  value={claudeModel}
                  onChange={(e) => handleClaudeModelChange(e.target.value)}
                  className="w-full rounded border border-border bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                >
                  {claudeModels.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.displayName || m.slug}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  {claudeModels.map((m) => (
                    <Button
                      key={m.slug}
                      variant={claudeModel === m.slug ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleClaudeModelChange(m.slug)}
                      className="flex-1 capitalize"
                    >
                      {formatModelName(m)}
                    </Button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Codex Model */}
          {runner === "codex" && codexAvailable && codexModels.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-2">
                Codex Model
                {runners?.codex?.currentModel && (
                  <span className="text-xs text-text-tertiary ml-2">
                    (config: {runners.codex.currentModel})
                  </span>
                )}
              </h3>
              {useDropdownForCodex ? (
                <select
                  value={codexModel}
                  onChange={(e) => handleCodexModelChange(e.target.value)}
                  className="w-full rounded border border-border bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                >
                  {codexModels.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.displayName || m.slug}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {codexModels.map((m) => (
                    <Button
                      key={m.slug}
                      variant={codexModel === m.slug ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleCodexModelChange(m.slug)}
                      className="flex-1 min-w-[70px]"
                    >
                      {formatModelName(m)}
                    </Button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Thinking Level - only show if model supports it */}
          {(runner === "claude" || runner === "codex") && availableThinkingLevels.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                <Brain className="h-4 w-4 text-text-secondary" />
                Thinking Level
              </h3>
              <div className="flex gap-2">
                {availableThinkingLevels.map((level) => (
                  <Button
                    key={level.effort}
                    variant={thinkingLevel === level.effort ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleThinkingLevelChange(level.effort)}
                    className="flex-1 capitalize"
                    title={level.description}
                  >
                    {level.effort === "xhigh" ? "X-High" : level.effort}
                  </Button>
                ))}
              </div>
            </section>
          )}

          {/* Fix Options */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-text-secondary" />
              What to Fix
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-secondary border border-border">
                <div>
                  <p className="text-sm text-text-primary">CI Failures</p>
                  <p className="text-xs text-text-tertiary">Fix failing builds and tests</p>
                </div>
                <Button
                  variant={fix.ci ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleFixToggle("ci")}
                >
                  {fix.ci ? "On" : "Off"}
                </Button>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-secondary border border-border">
                <div>
                  <p className="text-sm text-text-primary">PR Comments</p>
                  <p className="text-xs text-text-tertiary">Address reviewer feedback</p>
                </div>
                <Button
                  variant={fix.comments ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleFixToggle("comments")}
                >
                  {fix.comments ? "On" : "Off"}
                </Button>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-secondary border border-border">
                <div>
                  <p className="text-sm text-text-primary">Merge Conflicts</p>
                  <p className="text-xs text-text-tertiary text-amber-500/80">⚠️ Experimental - use with caution</p>
                </div>
                <Button
                  variant={fix.conflicts ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleFixToggle("conflicts")}
                >
                  {fix.conflicts ? "On" : "Off"}
                </Button>
              </div>
            </div>
          </section>

          {/* Push */}
          <section>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary border border-border">
              <div>
                <p className="text-sm text-text-primary">Push changes</p>
                <p className="text-xs text-text-tertiary">
                  Allow commits and pushes
                </p>
              </div>
              <Button
                variant={pushEnabled ? "default" : "outline"}
                size="sm"
                onClick={handlePushChange}
              >
                {pushEnabled ? "On" : "Off"}
              </Button>
            </div>
          </section>

          {/* Save */}
          {isDirty && (
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
              className="w-full"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
