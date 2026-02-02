import type { TimelineClip } from '@/app/types/timeline';
import type { TextTemplateType } from '@/app/types/timeline';

/**
 * Returns the Motion Canvas scene node key used for a clip.
 * Used for hit detection and selection overlay. Text templates use container
 * keys (title-card, lower-third, caption-style); basic text and other clip
 * types use the standard clip key.
 */
export function getSceneNodeKey(clip: TimelineClip): string | null {
  if (clip.type === 'video') return `video-clip-${clip.id}`;
  if (clip.type === 'image') return `image-clip-${clip.id}`;
  if (clip.type === 'audio') return null;
  if (clip.type === 'text') {
    const template: TextTemplateType | undefined = clip.template ?? 'text';
    switch (template) {
      case 'title-card':
        return `title-card-container-${clip.id}`;
      case 'lower-third':
        return `lower-third-container-${clip.id}`;
      case 'caption-style':
        return `caption-style-container-${clip.id}`;
      case 'text':
      default:
        return `text-clip-${clip.id}`;
    }
  }
  return null;
}
