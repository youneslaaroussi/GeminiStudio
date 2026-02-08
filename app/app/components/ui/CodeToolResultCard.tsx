"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type FC,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  FileCode2,
  ExternalLink,
  Plus,
  Pencil,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeToolResultCardProps {
  /** Programming language for syntax highlighting */
  language: string;
  /** Optional filename displayed in the header */
  filename?: string;
  /** The full (new) code */
  code: string;
  /** Previous code -- when set the card renders a diff view */
  oldCode?: string;
  /** One-line summary displayed under the header */
  summary?: string;
  /** Whether the card starts expanded (default: false) */
  defaultExpanded?: boolean;
  /** Callback when "Open in Editor" is clicked */
  onOpenInEditor?: () => void;
}

// ---------------------------------------------------------------------------
// Diff helpers (line-level, no external dep needed for simple inline diff)
// ---------------------------------------------------------------------------

interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({
        type: "context",
        content: oldLines[i - 1],
        oldLineNo: i,
        newLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        type: "add",
        content: newLines[j - 1],
        newLineNo: j,
      });
      j--;
    } else {
      stack.push({
        type: "remove",
        content: oldLines[i - 1],
        oldLineNo: i,
      });
      i--;
    }
  }

  // Reverse since we built it backwards
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k]);
  }

  return result;
}

/** Collapse long context runs into a "N unchanged lines" placeholder */
interface DiffSection {
  type: "lines" | "collapsed";
  lines?: DiffLine[];
  count?: number;
}

function collapseDiff(
  diffLines: DiffLine[],
  contextRadius: number = 3
): DiffSection[] {
  // Mark which lines should be visible (within contextRadius of a change)
  const visible = new Array(diffLines.length).fill(false);
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== "context") {
      for (
        let j = Math.max(0, i - contextRadius);
        j <= Math.min(diffLines.length - 1, i + contextRadius);
        j++
      ) {
        visible[j] = true;
      }
    }
  }

  const sections: DiffSection[] = [];
  let i = 0;
  while (i < diffLines.length) {
    if (visible[i]) {
      const lines: DiffLine[] = [];
      while (i < diffLines.length && visible[i]) {
        lines.push(diffLines[i]);
        i++;
      }
      sections.push({ type: "lines", lines });
    } else {
      let count = 0;
      while (i < diffLines.length && !visible[i]) {
        count++;
        i++;
      }
      sections.push({ type: "collapsed", count });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Shiki async loader
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<any> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: ["github-dark"],
        langs: ["tsx", "typescript", "javascript", "jsx", "css", "json"],
      })
    );
  }
  return highlighterPromise;
}

function useHighlightedHtml(code: string, lang: string) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      try {
        const result = highlighter.codeToHtml(code, {
          lang: lang === "tsx" ? "tsx" : lang === "ts" ? "typescript" : lang,
          theme: "github-dark",
        });
        setHtml(result);
      } catch {
        // Fallback: wrap in pre
        setHtml(
          `<pre class="shiki" style="background-color:#0d1117"><code>${escapeHtml(code)}</code></pre>`
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return html;
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CopyButton: FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors"
      title="Copy code"
    >
      {copied ? (
        <Check className="size-3 text-emerald-400" />
      ) : (
        <Copy className="size-3" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
};

/** Code block with Shiki highlighting + line numbers */
const HighlightedCodeBlock: FC<{
  code: string;
  language: string;
  maxLines?: number;
}> = ({ code, language, maxLines = 15 }) => {
  const [expanded, setExpanded] = useState(false);
  const lines = code.split("\n");
  const truncated = !expanded && lines.length > maxLines;
  const displayCode = truncated ? lines.slice(0, maxLines).join("\n") : code;
  const remainingCount = lines.length - maxLines;

  const html = useHighlightedHtml(displayCode, language);

  return (
    <div className="relative">
      <div
        className="code-highlighted text-[11px] leading-[1.6] overflow-x-auto [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent [&_.line]:pl-2"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {truncated && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-1.5 text-[10px] font-medium text-zinc-500 hover:text-zinc-300 bg-gradient-to-t from-zinc-900/90 to-transparent transition-colors"
        >
          Show {remainingCount} more line{remainingCount > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
};

/** Inline diff view */
const DiffView: FC<{ oldCode: string; newCode: string }> = ({
  oldCode,
  newCode,
}) => {
  const sections = useMemo(() => {
    const diff = computeLineDiff(oldCode, newCode);
    return collapseDiff(diff);
  }, [oldCode, newCode]);

  return (
    <div className="text-[11px] leading-[1.6] font-mono overflow-x-auto">
      {sections.map((section, si) => {
        if (section.type === "collapsed") {
          return (
            <div
              key={si}
              className="px-3 py-1 text-[10px] text-zinc-500 bg-zinc-800/40 border-y border-zinc-700/30 select-none"
            >
              {section.count} unchanged line{section.count! > 1 ? "s" : ""}
            </div>
          );
        }
        return (
          <div key={si}>
            {section.lines!.map((line, li) => {
              const bgClass =
                line.type === "add"
                  ? "bg-emerald-500/10"
                  : line.type === "remove"
                    ? "bg-red-500/10"
                    : "";
              const gutterClass =
                line.type === "add"
                  ? "text-emerald-500"
                  : line.type === "remove"
                    ? "text-red-500"
                    : "text-zinc-600";
              const gutterChar =
                line.type === "add"
                  ? "+"
                  : line.type === "remove"
                    ? "-"
                    : " ";
              const textClass =
                line.type === "add"
                  ? "text-emerald-300"
                  : line.type === "remove"
                    ? "text-red-300/70 line-through decoration-red-500/30"
                    : "text-zinc-400";

              return (
                <div
                  key={`${si}-${li}`}
                  className={`flex ${bgClass} hover:brightness-110`}
                >
                  <span
                    className={`select-none w-5 text-right pr-1 shrink-0 ${gutterClass} font-bold`}
                  >
                    {gutterChar}
                  </span>
                  <span
                    className={`select-none w-8 text-right pr-2 shrink-0 text-zinc-600`}
                  >
                    {line.type === "remove"
                      ? line.oldLineNo
                      : line.type === "add"
                        ? line.newLineNo
                        : line.newLineNo}
                  </span>
                  <span className={`flex-1 whitespace-pre ${textClass}`}>
                    {line.content}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CodeToolResultCard: FC<CodeToolResultCardProps> = ({
  language,
  filename,
  code,
  oldCode,
  summary,
  defaultExpanded = false,
  onOpenInEditor,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isEdit = oldCode !== undefined && oldCode !== code;
  const StatusIcon = isEdit ? Pencil : Plus;
  const statusLabel = isEdit ? "Edited" : "Created";
  const statusColor = isEdit
    ? "text-blue-400 bg-blue-500/15"
    : "text-emerald-400 bg-emerald-500/15";

  return (
    <div className="my-2 rounded-lg border border-zinc-700/60 bg-zinc-900/80 overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/50 transition-colors text-left"
      >
        <FileCode2 className="size-3.5 text-zinc-400 shrink-0" />
        {filename && (
          <span className="text-[11px] font-medium text-zinc-200 truncate">
            {filename}
          </span>
        )}
        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
          {language}
        </span>
        <span
          className={`ml-auto flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor}`}
        >
          <StatusIcon className="size-2.5" />
          {statusLabel}
        </span>
        {expanded ? (
          <ChevronDown className="size-3.5 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 text-zinc-500 shrink-0" />
        )}
      </button>

      {/* Summary */}
      {summary && !expanded && (
        <div className="px-3 pb-2 text-[10px] text-zinc-500 truncate">
          {summary}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-700/40">
          {/* Summary when expanded */}
          {summary && (
            <div className="px-3 py-1.5 text-[10px] text-zinc-500 border-b border-zinc-700/30">
              {summary}
            </div>
          )}

          {/* Code / Diff view */}
          <div className="bg-[#0d1117] rounded-b-lg">
            {isEdit ? (
              <DiffView oldCode={oldCode!} newCode={code} />
            ) : (
              <HighlightedCodeBlock code={code} language={language} />
            )}
          </div>

          {/* Actions bar */}
          <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-900/60 border-t border-zinc-700/30">
            <CopyButton text={code} />
            {onOpenInEditor && (
              <button
                onClick={onOpenInEditor}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors"
              >
                <ExternalLink className="size-3" />
                Open in Editor
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
