"use client";

import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { createMentionSuggestion } from "./useMentionSuggestion";
import { AssetMentionExtension } from "./mention-extension";

import type { ChatInputProps, ChatInputRef, AssetMention } from "./types";
import { ASSET_DRAG_DATA_MIME, type AssetDragPayload } from "@/app/types/assets";
import { cn } from "@/lib/utils";
import "./chat-input.css";

/**
 * Build plain text with mention nodes expanded to "@label", and extract mentions
 * with start/end indices in that same string. ProseMirror's getText() omits
 * custom nodes (mentions have no textContent), so we must build the string
 * ourselves so stored message text and mention ranges stay in sync.
 */
function extractPlainTextAndMentions(editor: ReturnType<typeof useEditor>): {
  text: string;
  mentions: AssetMention[];
} {
  if (!editor) return { text: "", mentions: [] };

  const parts: string[] = [];
  const mentions: AssetMention[] = [];
  let length = 0;

  editor.state.doc.descendants((node) => {
    // Block boundary: insert newline between blocks (match getText() behavior)
    if (node.isBlock && node.type.name !== "doc" && length > 0) {
      parts.push("\n");
      length += 1;
    }
    if (node.type.name === "mention") {
      const label = node.attrs.label ?? node.attrs.id ?? "";
      const plainText = `@${label}`;
      const start = length;
      parts.push(plainText);
      length += plainText.length;
      mentions.push({
        id: node.attrs.id,
        name: label,
        type: node.attrs.type || "other",
        url: node.attrs.url,
        thumbnailUrl: node.attrs.thumbnailUrl,
        description: node.attrs.description,
        start,
        end: start + plainText.length,
        plainText,
      });
      return;
    }
    if (node.isText) {
      const t = node.text ?? "";
      parts.push(t);
      length += t.length;
    }
  });

  const text = parts.join("");
  return { text, mentions };
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  ({ projectId, disabled = false, submitDisabled = false, placeholder = "What would you like to do?", onSubmit, onContentChange }, ref) => {
    const [isSuggestionActive, setIsSuggestionActive] = useState(false);
    const isSuggestionActiveRef = useRef(false);
    const handleSubmitRef = useRef<() => void>(() => {});
    const submitDisabledRef = useRef(submitDisabled);
    const [isDragOver, setIsDragOver] = useState(false);

    submitDisabledRef.current = submitDisabled;

    // Memoize the suggestion config so it doesn't recreate on every render
    const mentionSuggestion = useMemo(() => {
      console.log("[ChatInput] Creating mention suggestion with projectId:", projectId);
      return createMentionSuggestion(projectId);
    }, [projectId]);

    const editor = useEditor({
      immediatelyRender: false, // Avoid SSR hydration mismatch
      extensions: [
        StarterKit.configure({
          // Disable formatting - we want plain text + mentions only
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          heading: false,
          horizontalRule: false,
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass: "is-editor-empty",
        }),
        AssetMentionExtension.configure({
          HTMLAttributes: {
            class: "mention-chip",
            title: "",
          },
          suggestion: {
            ...mentionSuggestion,
            // Track when suggestion popup is active
            render: () => {
              const original = mentionSuggestion.render?.();
              if (!original) {
                return {
                  onStart: () => {},
                  onUpdate: () => {},
                  onKeyDown: () => false,
                  onExit: () => {},
                };
              }
              return {
                onStart: (props) => {
                  isSuggestionActiveRef.current = true;
                  setIsSuggestionActive(true);
                  original.onStart?.(props);
                },
                onUpdate: original.onUpdate,
                onKeyDown: original.onKeyDown,
                onExit: (props) => {
                  isSuggestionActiveRef.current = false;
                  setIsSuggestionActive(false);
                  original.onExit?.(props);
                },
              };
            },
          },
        }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap chat-input-editor",
        },
        handleKeyDown: (view, event) => {
          // Don't handle Enter if suggestion dropdown is active (use ref for sync access)
          if (isSuggestionActiveRef.current) return false;

          // Enter without Shift: submit (unless submitDisabled). Shift+Enter: newline (don't intercept).
          if (event.key === "Enter" && !event.shiftKey) {
            if (submitDisabledRef.current) return false; // Let Enter insert newline when sending is disabled
            event.preventDefault();
            event.stopPropagation();
            handleSubmitRef.current();
            return true;
          }

          return false;
        },
      },
      editable: !disabled,
      // Only recreate editor when project/mention config changes; avoid losing input when
      // placeholder or submitDisabled change (handled via refs / setEditable).
    }, [mentionSuggestion]);

    // Update editable state when disabled changes
    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled);
      }
    }, [editor, disabled]);

    // Track content changes for external state management (e.g., disable send button)
    useEffect(() => {
      if (!editor || !onContentChange) return;

      const updateHandler = () => {
        const hasContent = !editor.isEmpty;
        onContentChange(hasContent);
      };

      editor.on("update", updateHandler);
      // Call immediately to set initial state
      updateHandler();

      return () => {
        editor.off("update", updateHandler);
      };
    }, [editor, onContentChange]);

    const handleSubmit = useCallback(() => {
      if (!editor || submitDisabled) return;

      const { text: rawText, mentions } = extractPlainTextAndMentions(editor);
      const text = rawText.trim();

      // Don't submit if empty
      if (!text && mentions.length === 0) return;

      // Trim shifts character indices: adjust mention start/end to match trimmed text
      const trimStart = rawText.length - rawText.trimStart().length;
      const adjustedMentions = mentions.map((m) => {
        if (m.start == null || m.end == null) return m;
        const start = Math.max(0, (m.start ?? 0) - trimStart);
        const end = Math.max(start, Math.min(text.length, (m.end ?? 0) - trimStart));
        return { ...m, start, end };
      });

      onSubmit(text, adjustedMentions);
      editor.commands.clearContent();
    }, [editor, onSubmit, submitDisabled]);

    // Refs so handleKeyDown (captured once at editor creation) always sees current values
    useEffect(() => {
      handleSubmitRef.current = handleSubmit;
    }, [handleSubmit]);

    // Expose ref methods
    useImperativeHandle(ref, () => ({
      focus: () => editor?.commands.focus(),
      clear: () => editor?.commands.clearContent(),
      isEmpty: () => !editor || editor.isEmpty,
      getEditor: () => editor,
      submit: handleSubmit,
      setText: (text: string) => {
        if (!editor) return;
        editor.chain().focus().clearContent().insertContent(text).run();
      },
    }), [editor, handleSubmit]);

    // Drag and drop handlers for assets
    const handleDragOver = useCallback((e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(ASSET_DRAG_DATA_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
      }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      // Only set false if we're leaving the container (not entering a child)
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setIsDragOver(false);
      }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      if (!editor) return;

      const data = e.dataTransfer.getData(ASSET_DRAG_DATA_MIME);
      if (!data) return;

      try {
        const asset: AssetDragPayload = JSON.parse(data);

        // Insert mention node at current cursor position (or end if no selection)
        editor
          .chain()
          .focus()
          .insertContent({
            type: "mention",
            attrs: {
              id: asset.id,
              label: asset.name,
              type: asset.type,
              url: asset.url,
            },
          })
          .insertContent(" ") // Add space after mention
          .run();
      } catch (err) {
        console.error("Failed to parse dropped asset:", err);
      }
    }, [editor]);

    return (
      <div
        className={cn(
          "chat-input-container flex-1 rounded-lg border bg-background focus-within:ring-2 focus-within:ring-primary/50 cursor-text transition-colors",
          isDragOver
            ? "border-primary border-dashed bg-primary/5"
            : "border-border"
        )}
        onClick={() => editor?.commands.focus()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <EditorContent editor={editor} />
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";
