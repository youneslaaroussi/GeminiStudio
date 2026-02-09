/**
 * Single source of truth for headless renderer fonts.
 * Used by: build-headless.ts (fonts.css, preloads, copy files) and main.ts (document.fonts.load).
 */
export declare const variableFonts: {
    name: string;
    key: string;
    file: string;
}[];
export declare const regularFonts: {
    name: string;
    key: string;
    weights: number[];
}[];
/** All font family names (for document.fonts.load). Derived from variableFonts + regularFonts. */
export declare const FONT_FAMILIES: string[];
