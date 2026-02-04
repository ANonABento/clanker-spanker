import { useState, useCallback } from "react";

interface UseSettingsReturn {
  isOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export function useSettings(): UseSettingsReturn {
  const [isOpen, setIsOpen] = useState(false);

  const openSettings = useCallback(() => setIsOpen(true), []);
  const closeSettings = useCallback(() => setIsOpen(false), []);

  return { isOpen, openSettings, closeSettings };
}
