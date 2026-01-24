"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { marked } from "marked";

function parseMarkdown(content: string): string[] {
  const tokens = marked.lexer(content ?? "");
  return tokens.map((token) => token.raw ?? "");
}

const MarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return <ReactMarkdown>{content}</ReactMarkdown>;
  },
  (prev, next) => prev.content === next.content
);

MarkdownBlock.displayName = "MarkdownBlock";

export const MemoizedMarkdown = memo(
  ({ content, id }: { content: string; id: string }) => {
    const blocks = useMemo(() => parseMarkdown(content), [content]);

    return blocks.map((block, index) => (
      <MarkdownBlock content={block} key={`${id}-block-${index}`} />
    ));
  }
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
