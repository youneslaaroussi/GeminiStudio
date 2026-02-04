// Font configuration - reads from shared/fonts.json (single source of truth)
// Used by text clips, captions, and the LangGraph setCaptionSettings tool

import fontsData from "../shared/fonts.json";

export interface FontConfig {
  name: string; // Display name
  family: string; // CSS font-family value
  isVariable: boolean; // Whether it's a variable font
  weights?: number[]; // For non-variable fonts: [400, 500, 700]
}

export const AVAILABLE_FONTS: FontConfig[] = fontsData.fonts as FontConfig[];

// Get unique font families, preferring variable fonts when both exist
const fontFamilyMap = new Map<string, FontConfig>();
for (const font of AVAILABLE_FONTS) {
  const baseName = font.family.replace(" Variable", "");
  const existing = fontFamilyMap.get(baseName);

  // Prefer variable fonts over regular fonts
  if (!existing || (font.isVariable && !existing.isVariable)) {
    fontFamilyMap.set(baseName, font);
  }
}

export const FONT_FAMILIES = Array.from(fontFamilyMap.values())
  .map((f) => f.family)
  .sort();
