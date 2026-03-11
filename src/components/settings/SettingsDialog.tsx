import { useEffect, useState, useMemo } from "react";
import { X, Sun, Moon, Power, Check, AlertCircle, Brain, Wrench, EyeOff, Users, ChevronDown, Settings, Cpu, Activity } from "lucide-react";
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

type AccordionSection = "general" | "ai" | "monitor";

interface AccordionProps {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Accordion({ title, icon, isOpen, onToggle, children }: AccordionProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-surface-secondary hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-text-secondary transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isOpen ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="p-3 space-y-3 border-t border-border">{children}</div>
      </div>
    </div>
  );
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
  const [ignoredChecks, setIgnoredChecks] = useState<string[]>([]);
  const [prScope, setPrScope] = useState<"all" | "involved">("all");
  const [pushEnabled, setPushEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedSection, setExpandedSection] = useState<AccordionSection | null>("general");

  const toggleSection = (section: AccordionSection) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

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
        setIgnoredChecks(settings.ignoredChecks || []);
        setPrScope(settings.prScope || "all");
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

  const handleIgnoredChecksChange = (value: string) => {
    const checks = value.split("\n").map((s) => s.trim()).filter(Boolean);
    setIgnoredChecks(checks);
    setIsDirty(true);
  };

  const handlePushChange = () => {
    setPushEnabled(!pushEnabled);
    setIsDirty(true);
  };

  const handlePrScopeChange = (value: "all" | "involved") => {
    setPrScope(value);
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
        ignoredChecks,
        prScope,
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

  const formatModelName = (model: ModelInfo) => {
    const name = model.displayName || model.slug;
    if (name.length > 12) {
      return name.replace("gpt-", "").replace("-codex", "");
    }
    return name;
  };

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
      <div className="relative bg-surface border border-border rounded-lg w-full max-w-md p-4 shadow-lg animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Close settings"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="space-y-3 overflow-y-auto flex-1 pr-1">
          {/* General Section */}
          <Accordion
            title="General"
            icon={<Settings className="h-4 w-4 text-text-secondary" />}
            isOpen={expandedSection === "general"}
            onToggle={() => toggleSection("general")}
          >
            {/* Theme */}
            <div>
              <p className="text-xs text-text-tertiary mb-1.5">Theme</p>
              <div className="flex gap-2">
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => onThemeChange("dark")}
                  className="flex-1"
                >
                  <Moon className="h-3 w-3 mr-1.5" />
                  Dark
                </Button>
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => onThemeChange("light")}
                  className="flex-1"
                >
                  <Sun className="h-3 w-3 mr-1.5" />
                  Light
                </Button>
              </div>
            </div>

            {/* Startup */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Power className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-sm text-text-primary">Start on login</span>
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

            {/* PR Scope */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Users className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-xs text-text-tertiary">PR Scope</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={prScope === "involved" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePrScopeChange("involved")}
                  className="flex-1"
                >
                  My PRs
                </Button>
                <Button
                  variant={prScope === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePrScopeChange("all")}
                  className="flex-1"
                >
                  All PRs
                </Button>
              </div>
            </div>
          </Accordion>

          {/* AI Section */}
          <Accordion
            title="AI Configuration"
            icon={<Cpu className="h-4 w-4 text-text-secondary" />}
            isOpen={expandedSection === "ai"}
            onToggle={() => toggleSection("ai")}
          >
            {/* Runner */}
            <div>
              <p className="text-xs text-text-tertiary mb-1.5">Runner</p>
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
                  className="flex-1"
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
                  className="flex-1"
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
            </div>

            {/* Claude Model */}
            {runner === "claude" && claudeAvailable && claudeModels.length > 0 && (
              <div>
                <p className="text-xs text-text-tertiary mb-1.5">Model</p>
                {useDropdownForClaude ? (
                  <select
                    value={claudeModel}
                    onChange={(e) => handleClaudeModelChange(e.target.value)}
                    className="w-full rounded border border-border bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none"
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
              </div>
            )}

            {/* Codex Model */}
            {runner === "codex" && codexAvailable && codexModels.length > 0 && (
              <div>
                <p className="text-xs text-text-tertiary mb-1.5">
                  Model
                  {runners?.codex?.currentModel && (
                    <span className="ml-1">(config: {runners.codex.currentModel})</span>
                  )}
                </p>
                {useDropdownForCodex ? (
                  <select
                    value={codexModel}
                    onChange={(e) => handleCodexModelChange(e.target.value)}
                    className="w-full rounded border border-border bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none"
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
              </div>
            )}

            {/* Thinking Level */}
            {(runner === "claude" || runner === "codex") && availableThinkingLevels.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Brain className="h-3.5 w-3.5 text-text-secondary" />
                  <span className="text-xs text-text-tertiary">Thinking Level</span>
                </div>
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
              </div>
            )}
          </Accordion>

          {/* Monitor Section */}
          <Accordion
            title="Monitor Behavior"
            icon={<Activity className="h-4 w-4 text-text-secondary" />}
            isOpen={expandedSection === "monitor"}
            onToggle={() => toggleSection("monitor")}
          >
            {/* Fix Options */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Wrench className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-xs text-text-tertiary">What to Fix</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-text-primary">CI Failures</span>
                  <Button
                    variant={fix.ci ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleFixToggle("ci")}
                  >
                    {fix.ci ? "On" : "Off"}
                  </Button>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-text-primary">PR Comments</span>
                  <Button
                    variant={fix.comments ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleFixToggle("comments")}
                  >
                    {fix.comments ? "On" : "Off"}
                  </Button>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm text-text-primary">Merge Conflicts</span>
                    <span className="text-xs text-amber-500/80 ml-1.5">⚠️ Experimental</span>
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
            </div>

            {/* Ignored CI Checks */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <EyeOff className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-xs text-text-tertiary">Ignored CI Checks</span>
              </div>
              <textarea
                value={ignoredChecks.join("\n")}
                onChange={(e) => handleIgnoredChecksChange(e.target.value)}
                placeholder="Check names to ignore (one per line)"
                className="w-full rounded border border-border bg-surface-secondary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none resize-none"
                rows={2}
              />
            </div>

            {/* Push */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-primary">Push changes</span>
              <Button
                variant={pushEnabled ? "default" : "outline"}
                size="sm"
                onClick={handlePushChange}
              >
                {pushEnabled ? "On" : "Off"}
              </Button>
            </div>
          </Accordion>
        </div>

        {/* Save Button - Fixed at bottom */}
        {isDirty && (
          <div className="pt-3 mt-3 border-t border-border">
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
              className="w-full"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
