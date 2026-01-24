import { useCallback, useState } from 'react';

interface UseEditableInputOptions {
  value: string;
  onCommit: (value: string) => void;
}

export function useEditableInput({ value, onCommit }: UseEditableInputOptions) {
  const [draft, setDraft] = useState<string | null>(null);

  const displayValue = draft ?? value;

  const commit = useCallback(() => {
    if (draft !== null && draft !== value) {
      onCommit(draft);
    }
    setDraft(null);
  }, [draft, value, onCommit]);

  const cancel = useCallback(() => {
    setDraft(null);
  }, []);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);

  const handleBlur = useCallback(() => {
    commit();
  }, [commit]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.currentTarget.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        event.currentTarget.blur();
      }
    },
    [cancel]
  );

  return {
    draft: displayValue,
    handleChange,
    handleBlur,
    handleKeyDown,
  };
}
