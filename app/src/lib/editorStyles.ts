// Editor appearance settings: line height, block spacing, caption style.
// Values are stored via the app settings system and applied as injected CSS.

import { getSetting, setSetting, useSetting } from "@/lib/settings";

// ---- Setting keys & defaults ----

export const EDITOR_LINE_HEIGHT_KEY = "editor.lineHeight";
export const EDITOR_BLOCK_SPACING_KEY = "editor.blockSpacing";
export const EDITOR_CAPTION_ALIGN_KEY = "editor.captionAlignment";
export const EDITOR_CAPTION_SIZE_KEY = "editor.captionFontSize";

export const LINE_HEIGHT_DEFAULT = "1.7";
export const BLOCK_SPACING_DEFAULT = "normal";
export const CAPTION_ALIGN_DEFAULT = "center";
export const CAPTION_SIZE_DEFAULT = "0.75rem";

// ---- CSS generation ----

const BLOCK_SPACING_MAP: Record<string, string> = {
  tight: "1px 0",
  normal: "3px 0",
  relaxed: "7px 0",
};

export function buildEditorCss(
  lineHeight: string,
  blockSpacing: string,
  captionAlign: string,
  captionSize: string,
): string {
  const padding = BLOCK_SPACING_MAP[blockSpacing] ?? BLOCK_SPACING_MAP.normal;
  return `
.bn-block-outer { line-height: ${lineHeight}; }
.bn-block-content { padding: ${padding}; }
.bn-file-caption { text-align: ${captionAlign}; font-size: ${captionSize}; }
  `.trim();
}

// ---- Typed getters/setters ----

export function getLineHeight() {
  return getSetting<string>(EDITOR_LINE_HEIGHT_KEY, LINE_HEIGHT_DEFAULT);
}
export function setLineHeight(v: string) {
  return setSetting(EDITOR_LINE_HEIGHT_KEY, v);
}

export function getBlockSpacing() {
  return getSetting<string>(EDITOR_BLOCK_SPACING_KEY, BLOCK_SPACING_DEFAULT);
}
export function setBlockSpacing(v: string) {
  return setSetting(EDITOR_BLOCK_SPACING_KEY, v);
}

export function getCaptionAlign() {
  return getSetting<string>(EDITOR_CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT);
}
export function setCaptionAlign(v: string) {
  return setSetting(EDITOR_CAPTION_ALIGN_KEY, v);
}

export function getCaptionSize() {
  return getSetting<string>(EDITOR_CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT);
}
export function setCaptionSize(v: string) {
  return setSetting(EDITOR_CAPTION_SIZE_KEY, v);
}

// ---- React hook ----

export function useEditorStyles(): string {
  const lineHeight = useSetting<string>(EDITOR_LINE_HEIGHT_KEY, LINE_HEIGHT_DEFAULT) ?? LINE_HEIGHT_DEFAULT;
  const blockSpacing = useSetting<string>(EDITOR_BLOCK_SPACING_KEY, BLOCK_SPACING_DEFAULT) ?? BLOCK_SPACING_DEFAULT;
  const captionAlign = useSetting<string>(EDITOR_CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT) ?? CAPTION_ALIGN_DEFAULT;
  const captionSize = useSetting<string>(EDITOR_CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT) ?? CAPTION_SIZE_DEFAULT;
  return buildEditorCss(lineHeight, blockSpacing, captionAlign, captionSize);
}
