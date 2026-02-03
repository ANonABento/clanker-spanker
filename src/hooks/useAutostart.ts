import { useState, useEffect, useCallback } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

export function useAutostart() {
  const [isAutoStartEnabled, setIsAutoStartEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    isEnabled()
      .then(setIsAutoStartEnabled)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const toggleAutoStart = useCallback(async () => {
    try {
      if (isAutoStartEnabled) {
        await disable();
        setIsAutoStartEnabled(false);
      } else {
        await enable();
        setIsAutoStartEnabled(true);
      }
    } catch (error) {
      console.error("Failed to toggle autostart:", error);
    }
  }, [isAutoStartEnabled]);

  return { isAutoStartEnabled, isLoading, toggleAutoStart };
}
