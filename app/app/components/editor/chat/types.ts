import type { AssetType } from "@/app/types/assets";
import type { Editor } from "@tiptap/react";

/**
 * Represents an asset mentioned in the chat input
 */
export interface AssetMention {
  id: string;
  name: string;
  type: AssetType;
  url?: string;
  thumbnailUrl?: string;
  description?: string;
}

/**
 * Props for the ChatInput component
 */
export interface ChatInputProps {
  projectId: string | null;
  disabled?: boolean;
  /** When true, input stays editable but Enter won't submit (e.g. while a message is sending) */
  submitDisabled?: boolean;
  placeholder?: string;
  onSubmit: (text: string, mentions: AssetMention[]) => void;
  /** Called when content changes, with true if the editor has content */
  onContentChange?: (hasContent: boolean) => void;
}

/**
 * Ref interface for ChatInput component
 */
export interface ChatInputRef {
  focus: () => void;
  clear: () => void;
  isEmpty: () => boolean;
  getEditor: () => Editor | null;
  /** Programmatically trigger submit (used by external Send button) */
  submit: () => void;
}

/**
 * Item returned from asset search for mention suggestions
 */
export interface MentionSuggestionItem {
  id: string;
  name: string;
  type: AssetType;
  description?: string;
  url?: string;
  thumbnailUrl?: string;
  highlights?: {
    name?: string;
    description?: string;
  };
}

/**
 * Props for the MentionList dropdown component
 */
export interface MentionListProps {
  items: MentionSuggestionItem[];
  isLoading: boolean;
  selectedIndex: number;
  onSelect: (item: MentionSuggestionItem) => void;
}

/**
 * Ref interface for MentionList (keyboard handling)
 */
export interface MentionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}
