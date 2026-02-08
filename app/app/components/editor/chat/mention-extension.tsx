import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import { FileVideo, Image, Music, File, Box } from "lucide-react";
import { cn } from "@/lib/utils";

export const MENTION_TOKEN_REGEX = /@([^\s]+)/g;

type MentionAppearance = {
  className: string;
  Icon: LucideIcon;
};

const MENTION_APPEARANCES: Record<string, MentionAppearance> = {
  video: { className: "mention-chip--video", Icon: FileVideo },
  image: { className: "mention-chip--image", Icon: Image },
  audio: { className: "mention-chip--audio", Icon: Music },
  component: { className: "mention-chip--component", Icon: Box },
  other: { className: "mention-chip--other", Icon: File },
};

export function getMentionAppearance(type: string | null | undefined) {
  if (!type) return MENTION_APPEARANCES.other;
  return MENTION_APPEARANCES[type] ?? MENTION_APPEARANCES.other;
}

function MentionChipNodeView(props: NodeViewProps) {
  const type = (props.node.attrs.type as string) ?? "other";
  const label = (props.node.attrs.label as string) ?? props.node.attrs.id ?? "";
  const assetId = (props.node.attrs.id as string) ?? "";
  const appearance = getMentionAppearance(type);

  const className = cn(
    "mention-chip",
    appearance.className,
    props.selected && "mention-chip--selected"
  );

  return (
    <NodeViewWrapper
      as="span"
      className={className}
      data-type="mention"
      data-source="editor"
      data-mention-id={assetId ?? ""}
      data-mention-name={label}
      data-asset-type={type}
      title={assetId ? "Locate in Assets" : undefined}
    >
      <appearance.Icon className="mention-chip-icon" aria-hidden="true" />
      <span className="mention-chip-label">{`@${label}`}</span>
    </NodeViewWrapper>
  );
}

export const AssetMentionExtension = Mention.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      type: {
        default: "other",
        parseHTML: (el) => el.getAttribute("data-asset-type") || "other",
        renderHTML: (attrs) =>
          attrs.type ? { "data-asset-type": attrs.type } : {},
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const type = (node.attrs.type as string) || "other";
    const appearance = getMentionAppearance(type);
    const label = (node.attrs.label as string) ?? node.attrs.id ?? "";
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        HTMLAttributes ?? {},
        {
          class: cn("mention-chip", appearance.className),
          "data-asset-type": type,
          "data-mention-id": node.attrs.id ?? "",
          "data-mention-name": label,
        }
      ),
      `@${label}`,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionChipNodeView);
  },
});

