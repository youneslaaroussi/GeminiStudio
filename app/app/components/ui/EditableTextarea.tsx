"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useEditableInput } from "@/app/hooks/use-editable-input";

export interface EditableTextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "onBlur" | "onKeyDown"
  > {
  value: string | number | null | undefined;
  onValueCommit: (value: string) => void;
  commitOnChange?: boolean;
}

export const EditableTextarea = forwardRef<HTMLTextAreaElement, EditableTextareaProps>(
  (
    {
      value,
      onValueCommit,
      className,
      commitOnChange = false,
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
        <textarea
          ref={ref}
          value={stringValue}
          onChange={(event) => onValueCommit(event.target.value)}
          className={cn(className)}
          {...rest}
        />
      );
    }

    return (
      <textarea
        ref={ref}
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

EditableTextarea.displayName = "EditableTextarea";
