"use client";

import Link, { isAllowedUri as linkIsAllowedUri } from "@tiptap/extension-link";
import { mergeAttributes } from "@tiptap/core";

/** Matches YouTube watch and short URLs (same as API route). */
export const YOUTUBE_URL_REGEX =
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+(?:&[\w=&.-]*)?$|^https?:\/\/youtu\.be\/[\w-]+(?:\?[\w=&.-]*)?$/i;

export function isYouTubeUrl(href: string | undefined): boolean {
  if (!href || typeof href !== "string") return false;
  return YOUTUBE_URL_REGEX.test(href.trim());
}

/**
 * Link extension that auto-links URLs and adds a special class for YouTube links
 * so they can be highlighted in the chat input.
 */
export const ChatLinkExtension = Link.extend({
  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes?.href;
    const allowed = this.options.isAllowedUri(href ?? "", {
      defaultValidate: (url) => !!linkIsAllowedUri(url, this.options.protocols),
      protocols: this.options.protocols,
      defaultProtocol: this.options.defaultProtocol,
    });
    if (!allowed) {
      return ["a", mergeAttributes(this.options.HTMLAttributes, { ...HTMLAttributes, href: "" }), 0];
    }
    const isYoutube = isYouTubeUrl(href);
    const linkClass = isYoutube ? "chat-link chat-link--youtube" : "chat-link";
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes ?? {}, {
      class: linkClass,
      ...(isYoutube ? { "data-youtube": "true" } : {}),
    });
    return ["a", attrs, 0];
  },
});
