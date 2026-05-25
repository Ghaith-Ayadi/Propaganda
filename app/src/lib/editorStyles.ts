// Editor appearance settings: per-block-type CSS controls.
// Values stored via the app settings system and applied as injected CSS.

import { getSetting, setSetting, useSetting } from "@/lib/settings";

// ─── Paragraph ───────────────────────────────────────────────────────────────

export const PARA_FONT_SIZE_KEY      = "editor.paragraph.fontSize";
export const PARA_FONT_WEIGHT_KEY    = "editor.paragraph.fontWeight";
export const PARA_LINE_HEIGHT_KEY    = "editor.paragraph.lineHeight";
export const PARA_LETTER_SPACING_KEY = "editor.paragraph.letterSpacing";
export const PARA_SPACING_KEY        = "editor.paragraph.spacing";

export const PARA_FONT_SIZE_DEFAULT      = "16px";
export const PARA_FONT_WEIGHT_DEFAULT    = "400";
export const PARA_LINE_HEIGHT_DEFAULT    = "1.7";
export const PARA_LETTER_SPACING_DEFAULT = "0em";
export const PARA_SPACING_DEFAULT        = "normal";

// ─── Image captions ──────────────────────────────────────────────────────────

export const CAPTION_ALIGN_KEY = "editor.captionAlignment";
export const CAPTION_SIZE_KEY  = "editor.captionFontSize";

export const CAPTION_ALIGN_DEFAULT = "center";
export const CAPTION_SIZE_DEFAULT  = "0.75rem";

// ─── CSS maps ────────────────────────────────────────────────────────────────

const PARA_SPACING_MAP: Record<string, string> = {
  tight:   "1px 0",
  normal:  "3px 0",
  relaxed: "7px 0",
};

// ─── CSS generation ──────────────────────────────────────────────────────────

export function buildEditorCss(
  paraFontSize: string,
  paraFontWeight: string,
  paraLineHeight: string,
  paraLetterSpacing: string,
  paraSpacing: string,
  captionAlign: string,
  captionSize: string,
): string {
  const padding = PARA_SPACING_MAP[paraSpacing] ?? PARA_SPACING_MAP.normal;
  return `
.bn-block-content[data-content-type="paragraph"] { font-size: ${paraFontSize}; font-weight: ${paraFontWeight}; line-height: ${paraLineHeight}; letter-spacing: ${paraLetterSpacing}; padding: ${padding}; }
.bn-file-caption { text-align: ${captionAlign}; font-size: ${captionSize}; }
  `.trim();
}

// ─── Typed getters / setters ─────────────────────────────────────────────────

export const getParaFontSize      = () => getSetting<string>(PARA_FONT_SIZE_KEY, PARA_FONT_SIZE_DEFAULT);
export const setParaFontSize      = (v: string) => setSetting(PARA_FONT_SIZE_KEY, v);

export const getParaFontWeight    = () => getSetting<string>(PARA_FONT_WEIGHT_KEY, PARA_FONT_WEIGHT_DEFAULT);
export const setParaFontWeight    = (v: string) => setSetting(PARA_FONT_WEIGHT_KEY, v);

export const getParaLineHeight    = () => getSetting<string>(PARA_LINE_HEIGHT_KEY, PARA_LINE_HEIGHT_DEFAULT);
export const setParaLineHeight    = (v: string) => setSetting(PARA_LINE_HEIGHT_KEY, v);

export const getParaLetterSpacing = () => getSetting<string>(PARA_LETTER_SPACING_KEY, PARA_LETTER_SPACING_DEFAULT);
export const setParaLetterSpacing = (v: string) => setSetting(PARA_LETTER_SPACING_KEY, v);

export const getParaSpacing       = () => getSetting<string>(PARA_SPACING_KEY, PARA_SPACING_DEFAULT);
export const setParaSpacing       = (v: string) => setSetting(PARA_SPACING_KEY, v);

export const getCaptionAlign      = () => getSetting<string>(CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT);
export const setCaptionAlign      = (v: string) => setSetting(CAPTION_ALIGN_KEY, v);

export const getCaptionSize       = () => getSetting<string>(CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT);
export const setCaptionSize       = (v: string) => setSetting(CAPTION_SIZE_KEY, v);

// ─── React hook ──────────────────────────────────────────────────────────────

export function useEditorStyles(): string {
  const paraFontSize      = useSetting<string>(PARA_FONT_SIZE_KEY, PARA_FONT_SIZE_DEFAULT) ?? PARA_FONT_SIZE_DEFAULT;
  const paraFontWeight    = useSetting<string>(PARA_FONT_WEIGHT_KEY, PARA_FONT_WEIGHT_DEFAULT) ?? PARA_FONT_WEIGHT_DEFAULT;
  const paraLineHeight    = useSetting<string>(PARA_LINE_HEIGHT_KEY, PARA_LINE_HEIGHT_DEFAULT) ?? PARA_LINE_HEIGHT_DEFAULT;
  const paraLetterSpacing = useSetting<string>(PARA_LETTER_SPACING_KEY, PARA_LETTER_SPACING_DEFAULT) ?? PARA_LETTER_SPACING_DEFAULT;
  const paraSpacing       = useSetting<string>(PARA_SPACING_KEY, PARA_SPACING_DEFAULT) ?? PARA_SPACING_DEFAULT;
  const captionAlign      = useSetting<string>(CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT) ?? CAPTION_ALIGN_DEFAULT;
  const captionSize       = useSetting<string>(CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT) ?? CAPTION_SIZE_DEFAULT;
  return buildEditorCss(
    paraFontSize,
    paraFontWeight,
    paraLineHeight,
    paraLetterSpacing,
    paraSpacing,
    captionAlign,
    captionSize,
  );
}
