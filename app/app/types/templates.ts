import type { TextTemplateType } from './timeline';

export interface TemplateDragPayload {
  templateType: TextTemplateType;
  name: string;
  duration: number;
}

export const TEMPLATE_DRAG_DATA_MIME = 'application/x-gemini-template';

export const DEFAULT_TEMPLATE_DURATION = 5;
