"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { MentionList } from "./MentionList";
import type { MentionSuggestionItem } from "./types";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

interface SuggestionState {
  isOpen: boolean;
  items: MentionSuggestionItem[];
  isLoading: boolean;
  selectedIndex: number;
  clientRect: (() => DOMRect | null) | null;
  command: ((item: MentionSuggestionItem) => void) | null;
}

/**
 * Creates a suggestion configuration for TipTap's Mention extension.
 * Fetches assets from the search API and renders a dropdown.
 */
export function createMentionSuggestion(
  projectId: string | null
): Omit<SuggestionOptions<MentionSuggestionItem>, "editor"> {
  let currentState: SuggestionState = {
    isOpen: false,
    items: [],
    isLoading: false,
    selectedIndex: 0,
    clientRect: null,
    command: null,
  };

  let updateCallback: ((state: SuggestionState) => void) | null = null;

  const setState = (updates: Partial<SuggestionState>) => {
    currentState = { ...currentState, ...updates };
    updateCallback?.(currentState);
  };

  const searchAssets = async (query: string): Promise<MentionSuggestionItem[]> => {
    if (!projectId) return [];

    try {
      const authHeaders = await getAuthHeaders();
      const trimmedQuery = query.trim();

      // If no query, list all assets; otherwise search
      if (!trimmedQuery) {
        const url = new URL("/api/assets", window.location.origin);
        url.searchParams.set("projectId", projectId);

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: authHeaders,
        });

        if (!response.ok) return [];

        const data = await response.json();
        const assets = data.assets || [];
        return assets.slice(0, 8).map((asset: Record<string, unknown>) => ({
          id: asset.id as string,
          name: asset.name as string,
          type: asset.type as string,
          description: asset.description as string | undefined,
          url: asset.url as string | undefined,
          thumbnailUrl: asset.thumbnailUrl as string | undefined,
        }));
      }

      // Search with query
      const url = new URL("/api/assets/search", window.location.origin);
      url.searchParams.set("projectId", projectId);

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuery, limit: 8 }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      // Search hits from Algolia don't include url; use proxy URL for thumbnails
      const proxyBase = `/api/assets`;
      return (data.hits || []).map((hit: Record<string, unknown>) => ({
        id: hit.id as string,
        name: hit.name as string,
        type: hit.type as string,
        description: hit.description as string | undefined,
        url: (hit.url as string | undefined) ?? `${proxyBase}/${hit.id}/file?projectId=${projectId}`,
        thumbnailUrl: hit.thumbnailUrl as string | undefined,
        highlights: hit.highlights as { name?: string; description?: string } | undefined,
      }));
    } catch (error) {
      console.error("Failed to search assets for mentions:", error);
      return [];
    }
  };

  return {
    char: "@",
    allowSpaces: false,
    startOfLine: false,

    items: async ({ query }: { query: string }) => {
      console.log("[MentionSuggestion] items called with query:", query, "projectId:", projectId);
      setState({ isLoading: true });
      const items = await searchAssets(query);
      console.log("[MentionSuggestion] got items:", items);
      setState({ items, isLoading: false, selectedIndex: 0 });
      return items;
    },

    render: () => {
      let container: HTMLDivElement | null = null;
      let root: ReturnType<typeof createPortal> | null = null;

      const renderDropdown = () => {
        if (!container || !currentState.clientRect) return;

        const rect = currentState.clientRect();
        if (!rect) return;

        const dropdownWidth = 256; // w-64 = 16rem = 256px
        const dropdownHeight = 192; // max-h-48 = 12rem = 192px
        const padding = 8;

        // Calculate horizontal position
        let left = rect.left;
        // If overflows right edge, align to right edge
        if (left + dropdownWidth > window.innerWidth - padding) {
          left = window.innerWidth - dropdownWidth - padding;
        }
        // If overflows left edge, align to left edge
        if (left < padding) {
          left = padding;
        }

        // Calculate vertical position - prefer above, fall back to below
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        container.style.position = "fixed";
        container.style.left = `${left}px`;
        container.style.zIndex = "50";

        if (spaceAbove >= dropdownHeight + padding || spaceAbove > spaceBelow) {
          // Position above
          container.style.bottom = `${window.innerHeight - rect.top + 4}px`;
          container.style.top = "auto";
        } else {
          // Position below
          container.style.top = `${rect.bottom + 4}px`;
          container.style.bottom = "auto";
        }
      };

      return {
        onStart: (props: SuggestionProps<MentionSuggestionItem>) => {
          container = document.createElement("div");
          container.className =
            "rounded-lg border border-border bg-card shadow-lg w-64 overflow-hidden";
          document.body.appendChild(container);

          setState({
            isOpen: true,
            clientRect: props.clientRect ?? null,
            command: (item) => {
              props.command({
                id: item.id,
                label: item.name,
                type: item.type,
                url: item.url,
                thumbnailUrl: item.thumbnailUrl,
                description: item.description,
              } as unknown as MentionSuggestionItem);
            },
          });

          updateCallback = (state) => {
            if (!container) return;

            const element = (
              <MentionList
                items={state.items}
                isLoading={state.isLoading}
                selectedIndex={state.selectedIndex}
                onSelect={(item) => state.command?.(item)}
              />
            );

            // Use ReactDOM to render into the container
            import("react-dom/client").then(({ createRoot }) => {
              if (!container) return;
              // @ts-expect-error - root management
              if (!container._root) {
                // @ts-expect-error - root management
                container._root = createRoot(container);
              }
              // @ts-expect-error - root management
              container._root.render(element);
            });

            renderDropdown();
          };

          // Trigger initial render
          updateCallback(currentState);
        },

        onUpdate: (props: SuggestionProps<MentionSuggestionItem>) => {
          setState({
            clientRect: props.clientRect ?? null,
            command: (item) => {
              props.command({
                id: item.id,
                label: item.name,
                type: item.type,
                url: item.url,
                thumbnailUrl: item.thumbnailUrl,
                description: item.description,
              } as unknown as MentionSuggestionItem);
            },
          });
          renderDropdown();
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          const { event } = props;

          if (event.key === "Escape") {
            setState({ isOpen: false });
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            const newIndex =
              currentState.selectedIndex > 0
                ? currentState.selectedIndex - 1
                : currentState.items.length - 1;
            setState({ selectedIndex: newIndex });
            return true;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            const newIndex =
              currentState.selectedIndex < currentState.items.length - 1
                ? currentState.selectedIndex + 1
                : 0;
            setState({ selectedIndex: newIndex });
            return true;
          }

          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const selectedItem = currentState.items[currentState.selectedIndex];
            if (selectedItem && currentState.command) {
              currentState.command(selectedItem);
            }
            return true;
          }

          return false;
        },

        onExit: () => {
          setState({ isOpen: false, items: [], selectedIndex: 0 });
          updateCallback = null;

          if (container) {
            // Cleanup React root
            // @ts-expect-error - root management
            if (container._root) {
              // @ts-expect-error - root management
              container._root.unmount();
            }
            container.remove();
            container = null;
          }
        },
      };
    },
  };
}
