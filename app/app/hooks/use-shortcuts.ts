import { useEffect } from 'react';

type KeyHandler = (e: KeyboardEvent) => void;

interface ShortcutConfig {
  key: string;
  handler: KeyHandler;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  preventDefault?: boolean;
  condition?: () => boolean; // Optional condition to check before executing
}

export function useShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable element
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (isInput) return;

      for (const config of shortcuts) {
        // Use e.code for letter/number keys when alt is involved (Mac produces special chars with Option)
        // e.code gives physical key like "KeyR", "KeyS", etc.
        const configKeyLower = config.key.toLowerCase();
        let keyMatches = e.key.toLowerCase() === configKeyLower;
        
        // Fallback to e.code for single letter keys (handles Mac Option key producing special chars)
        if (!keyMatches && configKeyLower.length === 1 && /^[a-z]$/.test(configKeyLower)) {
          const expectedCode = `Key${configKeyLower.toUpperCase()}`;
          keyMatches = e.code === expectedCode;
        }
        
        if (keyMatches) {
          // Check modifiers
          if (config.ctrlKey !== undefined && config.ctrlKey !== e.ctrlKey) continue;
          if (config.shiftKey !== undefined && config.shiftKey !== e.shiftKey) continue;
          if (config.altKey !== undefined && config.altKey !== e.altKey) continue;
          if (config.metaKey !== undefined && config.metaKey !== e.metaKey) continue;

          // Check custom condition
          if (config.condition && !config.condition()) continue;

          if (config.preventDefault) {
            e.preventDefault();
          }

          config.handler(e);
          return; // Execute only one shortcut per key press
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}
