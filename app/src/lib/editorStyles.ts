// Editor appearance settings: per-block-type CSS controls.
// Values stored as numbers via the app settings system and applied as injected CSS.

import { getSetting, setSetting, useSettingsVersion } from "@/lib/settings";

// ─── Block types ─────────────────────────────────────────────────────────────

export type BlockKey = "paragraph" | "h1" | "h2" | "h3" | "quote";

export interface BlockConfig {
  fontSize:      number; // px
  fontWeight:    number; // unitless
  lineHeight:    number; // unitless
  letterSpacing: number; // em
  spacing:       number; // px top/bottom padding
}

export const BLOCK_DEFAULTS: Record<BlockKey, BlockConfig> = {
  paragraph: { fontSize: 16, fontWeight: 400, lineHeight: 1.7,  letterSpacing:  0,     spacing: 4 },
  h1:        { fontSize: 36, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.02,  spacing: 8 },
  h2:        { fontSize: 28, fontWeight: 600, lineHeight: 1.25, letterSpacing: -0.01,  spacing: 6 },
  h3:        { fontSize: 22, fontWeight: 600, lineHeight: 1.35, letterSpacing:  0,     spacing: 4 },
  quote:     { fontSize: 16, fontWeight: 400, lineHeight: 1.8,  letterSpacing:  0,     spacing: 4 },
};

// ─── Setting keys ─────────────────────────────────────────────────────────────

export const BLOCK_PROPS = ["fontSize", "fontWeight", "lineHeight", "letterSpacing", "spacing"] as const;
export type BlockProp = (typeof BLOCK_PROPS)[number];

export function settingKey(block: BlockKey, prop: BlockProp): string {
  return `editor.${block}.${prop}`;
}

// ─── Getters / setters ────────────────────────────────────────────────────────

export function getBlockProp(block: BlockKey, prop: BlockProp): number {
  return (
    getSetting<number>(settingKey(block, prop), BLOCK_DEFAULTS[block][prop]) ??
    BLOCK_DEFAULTS[block][prop]
  );
}

export function setBlockProp(block: BlockKey, prop: BlockProp, value: number): Promise<void> {
  return setSetting(settingKey(block, prop), value);
}

// ─── Image captions ──────────────────────────────────────────────────────────

export const CAPTION_ALIGN_KEY     = "editor.captionAlignment";
export const CAPTION_SIZE_KEY      = "editor.captionFontSize";
export const CAPTION_ALIGN_DEFAULT = "center";
export const CAPTION_SIZE_DEFAULT  = "0.75rem";

export const getCaptionAlign = () => getSetting<string>(CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT);
export const setCaptionAlign = (v: string) => setSetting(CAPTION_ALIGN_KEY, v);
export const getCaptionSize  = () => getSetting<string>(CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT);
export const setCaptionSize  = (v: string) => setSetting(CAPTION_SIZE_KEY, v);

// ─── CSS selectors ────────────────────────────────────────────────────────────

const BLOCK_SELECTOR: Record<BlockKey, string> = {
  paragraph: '.bn-block-content[data-content-type="paragraph"]',
  h1:        '.bn-block-content[data-content-type="heading"][data-level="1"]',
  h2:        '.bn-block-content[data-content-type="heading"][data-level="2"]',
  h3:        '.bn-block-content[data-content-type="heading"][data-level="3"]',
  quote:     '.bn-block-content[data-content-type="quote"]',
};

// ─── CSS generation ──────────────────────────────────────────────────────────

function blockCss(block: BlockKey, cfg: BlockConfig): string {
  const sel = BLOCK_SELECTOR[block];
  return `${sel} { font-size: ${cfg.fontSize}px; font-weight: ${cfg.fontWeight}; line-height: ${cfg.lineHeight}; letter-spacing: ${cfg.letterSpacing}em; padding: ${cfg.spacing}px 0; }`;
}

export function buildEditorCss(
  configs: Record<BlockKey, BlockConfig>,
  captionAlign: string,
  captionSize: string,
): string {
  const lines = (Object.keys(configs) as BlockKey[]).map((b) => blockCss(b, configs[b]));
  lines.push(`.bn-file-caption { text-align: ${captionAlign}; font-size: ${captionSize}; }`);
  // Links render blue + underlined in the editor, matching the public reader.
  lines.push(
    `.bn-editor a, .bn-editor a:visited { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }`,
    `.bn-editor a:hover { color: #1d4ed8; }`,
  );
  // Image blocks expand to the full text column instead of sitting like an
  // attachment card. Keep the caption/resize chrome but let the image breathe.
  lines.push(
    `.bn-editor [data-content-type="image"] img,
     .bn-editor [data-content-type="image"] .bn-visual-media { width: 100%; max-width: 100%; height: auto; border-radius: 2px; }`,
  );
  // Notion-style upload state: while a file is uploading, BlockNote renders
  // <div class="bn-file-loading-preview">Loading...</div>. Turn that into a
  // grayed, softly shimmering placeholder block with an "Uploading…" label
  // instead of bare text.
  lines.push(
    `.bn-editor .bn-file-loading-preview {
       position: relative; width: 100%; min-height: 180px;
       display: flex; align-items: center; justify-content: center;
       color: transparent !important; border-radius: 4px; overflow: hidden;
       background: linear-gradient(90deg,
         color-mix(in srgb, var(--color-fg, #808080) 10%, transparent) 25%,
         color-mix(in srgb, var(--color-fg, #808080) 20%, transparent) 37%,
         color-mix(in srgb, var(--color-fg, #808080) 10%, transparent) 63%);
       background-size: 400% 100%;
       animation: bn-upload-shimmer 1.3s ease-in-out infinite;
     }`,
    `.bn-editor .bn-file-loading-preview::after {
       content: "Uploading…"; color: var(--color-fg, #6b6b6b); opacity: 0.7;
       font-size: 13px; letter-spacing: 0.02em;
     }`,
    `@keyframes bn-upload-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }`,
  );
  return lines.join("\n");
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useEditorStyles(): string {
  useSettingsVersion(); // re-render whenever any setting changes

  const configs = {} as Record<BlockKey, BlockConfig>;
  for (const block of Object.keys(BLOCK_DEFAULTS) as BlockKey[]) {
    configs[block] = {
      fontSize:      getBlockProp(block, "fontSize"),
      fontWeight:    getBlockProp(block, "fontWeight"),
      lineHeight:    getBlockProp(block, "lineHeight"),
      letterSpacing: getBlockProp(block, "letterSpacing"),
      spacing:       getBlockProp(block, "spacing"),
    };
  }

  const captionAlign = getSetting<string>(CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT) ?? CAPTION_ALIGN_DEFAULT;
  const captionSize  = getSetting<string>(CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT) ?? CAPTION_SIZE_DEFAULT;

  return buildEditorCss(configs, captionAlign, captionSize);
}
