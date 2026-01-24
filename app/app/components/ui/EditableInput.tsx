"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useEditableInput } from "@/app/hooks/use-editable-input";

export interface EditableInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "onBlur" | "onKeyDown"
  > {
  value: string | number | null | undefined;
  onValueCommit: (value: string) => void;
  commitOnChange?: boolean;
}

export const EditableInput = forwardRef<HTMLInputElement, EditableInputProps>(
  (
    {
      value,
      onValueCommit,
      className,
      commitOnChange = false,
      type = "text",
      ...rest
    },
    ref
  ) => {
    const stringValue =
      value === null || value === undefined ? "" : String(value);

    const { draft, handleChange, handleBlur, handleKeyDown } =
      useEditableInput({
        value: stringValue,
        onCommit: onValueCommit,
      });

    if (commitOnChange) {
      return (
        <input
          ref={ref}
          type={type}
          value={stringValue}
          onChange={(event) => onValueCommit(event.target.value)}
          className={cn(className)}
          {...rest}
        />
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(className)}
        {...rest}
      />
    );
  }
);

EditableInput.displayName = "EditableInput";
