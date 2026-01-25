"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UsePageReloadBlockerOptions {
  enabled: boolean;
  onBlock: () => void;
}

export function usePageReloadBlocker({
  enabled,
  onBlock,
}: UsePageReloadBlockerOptions) {
  const allowReloadRef = useRef(false);
  const onBlockRef = useRef(onBlock);

  useEffect(() => {
    onBlockRef.current = onBlock;
  }, [onBlock]);

  const [isBlocking, setBlocking] = useState(enabled);

  useEffect(() => {
    setBlocking(enabled);
    if (enabled) {
      console.debug("[reload-blocker] Enabled");
    } else {
      console.debug("[reload-blocker] Disabled");
    }
  }, [enabled]);

  const markReloadAllowed = useCallback(() => {
    console.debug("[reload-blocker] Allowing reload temporarily");
    allowReloadRef.current = true;
    setTimeout(() => {
      allowReloadRef.current = false;
    }, 1000);
  }, []);

  useEffect(() => {
    if (!isBlocking) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowReloadRef.current) {
        return;
      }
      console.debug("[reload-blocker] Blocking beforeunload");
      event.preventDefault();
      event.returnValue = "";
      onBlockRef.current();
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isBlocking]);

  useEffect(() => {
    if (!isBlocking) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key.toLowerCase() === "r" &&
          (event.metaKey || event.ctrlKey)) ||
        event.key === "F5"
      ) {
        event.preventDefault();
        if (!allowReloadRef.current) {
          console.debug("[reload-blocker] Intercepted reload shortcut");
          onBlockRef.current();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isBlocking]);

  return {
    allowReload: markReloadAllowed,
  };
}
