import { useEffect, useRef, useState } from "react";
import { Globe01, PenTool01, Upload01, User01, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { useSetting, setSetting } from "@/lib/settings";
import { uploadFile } from "@/lib/uploads";
import {
  PARA_FONT_SIZE_KEY, PARA_FONT_WEIGHT_KEY, PARA_LINE_HEIGHT_KEY, PARA_LETTER_SPACING_KEY, PARA_SPACING_KEY,
  PARA_FONT_SIZE_DEFAULT, PARA_FONT_WEIGHT_DEFAULT, PARA_LINE_HEIGHT_DEFAULT, PARA_LETTER_SPACING_DEFAULT, PARA_SPACING_DEFAULT,
  setParaFontSize, setParaFontWeight, setParaLineHeight, setParaLetterSpacing, setParaSpacing,
  CAPTION_ALIGN_KEY, CAPTION_SIZE_KEY, CAPTION_ALIGN_DEFAULT, CAPTION_SIZE_DEFAULT,
  setCaptionAlign, setCaptionSize,
} from "@/lib/editorStyles";

interface Props {
  onClose: () => void;
}

type Tab = "author" | "site" | "editor";

const DEFAULT_MANIFESTO =
  "It's called Verbatim because none of it is edited. I don't edit what I write. If I don't like what I said, I don't publish. No AI writing, no nonsense.";

export function SettingsDialog({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("author");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[640px] w-[760px] max-w-[95vw] max-h-[92vh] overflow-hidden rounded-xl border border-secondary bg-secondary shadow-2xl ring-1 ring-primary"
      >
        {/* Side tabs */}
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-secondary bg-primary p-3">
          <div className="mb-3 px-2 pt-1 font-title text-base text-primary">Settings</div>
          <TabButton active={tab === "author"} onClick={() => setTab("author")} icon={<User01 className="size-4" />}>
            Author
          </TabButton>
          <TabButton active={tab === "site"} onClick={() => setTab("site")} icon={<Globe01 className="size-4" />}>
            Site
          </TabButton>
          <TabButton active={tab === "editor"} onClick={() => setTab("editor")} icon={<PenTool01 className="size-4" />}>
            Editor
          </TabButton>
        </nav>

        {/* Body */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-secondary px-5 py-3">
            <div className="text-sm font-semibold text-primary capitalize">{tab}</div>
            <button
              aria-label="Close"
              onClick={onClose}
              className="rounded-md p-1 text-quaternary transition hover:bg-tertiary hover:text-primary"
            >
              <XClose className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            {tab === "author" && <AuthorTab />}
            {tab === "site" && <SiteTab />}
            {tab === "editor" && <EditorTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
        active
          ? "bg-tertiary font-medium text-primary"
          : "text-secondary hover:bg-tertiary hover:text-primary",
      ].join(" ")}
    >
      {icon && <span className="text-quaternary">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

function AuthorTab() {
  const name = useSetting<string>("author.name", "");
  const tagline = useSetting<string>("author.tagline", "");
  const bio = useSetting<string>("author.bio", "");
  const location = useSetting<string>("author.location", "");
  const faviconUrl = useSetting<string | null>("favicon.url", null);

  return (
    <div className="space-y-5">
      <Field label="Name">
        <Input
          size="sm"
          value={name ?? ""}
          onChange={(v) => void setSetting("author.name", v)}
        />
      </Field>
      <Field label="Tagline" hint="One line. Shows under the title on the public site.">
        <Input
          size="sm"
          value={tagline ?? ""}
          onChange={(v) => void setSetting("author.tagline", v)}
        />
      </Field>
      <Field label="Location" hint="Where you write from.">
        <Input
          size="sm"
          value={location ?? ""}
          onChange={(v) => void setSetting("author.location", v)}
        />
      </Field>
      <Field label="Bio" hint="A paragraph or two. Plain text.">
        <textarea
          value={bio ?? ""}
          onChange={(e) => void setSetting("author.bio", e.target.value)}
          rows={7}
          className="w-full resize-none rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 ease-linear focus:ring-2 focus:ring-inset focus:ring-brand"
        />
      </Field>
      <FaviconField current={faviconUrl ?? null} />
    </div>
  );
}

function SiteTab() {
  const manifesto = useSetting<string>("site.manifesto", DEFAULT_MANIFESTO);
  return (
    <div className="space-y-5">
      <Field
        label="Manifesto"
        hint="Shown on the public home page above the post list."
      >
        <textarea
          value={manifesto ?? ""}
          onChange={(e) => void setSetting("site.manifesto", e.target.value)}
          rows={5}
          className="w-full resize-none rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 ease-linear focus:ring-2 focus:ring-inset focus:ring-brand"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        {label}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs text-tertiary">{hint}</p>}
    </label>
  );
}

function FaviconField({ current }: { current: string | null }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(file: File) {
    setUploading(true);
    try {
      const url = await uploadFile(file);
      await setSetting("favicon.url", url);
    } catch (e) {
      console.error(e);
      alert(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        Favicon
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-secondary bg-primary p-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-secondary bg-secondary">
          {current ? (
            <img src={current} alt="favicon" className="h-10 w-10 object-contain" />
          ) : (
            <span className="font-title text-xl text-quaternary">V</span>
          )}
        </div>
        <div className="flex-1 text-xs text-tertiary">
          {current ? (
            <>
              <div className="truncate text-primary">{current.split("/").pop()}</div>
              <div className="mt-0.5 text-quaternary">PNG or SVG, 64×64 or larger.</div>
            </>
          ) : (
            <>
              Upload a small PNG or SVG.
              <div className="mt-0.5 text-quaternary">Square, 64×64 or larger.</div>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/svg+xml,image/x-icon,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          color="tertiary"
          iconLeading={Upload01}
          onClick={() => fileRef.current?.click()}
          isDisabled={uploading}
        >
          {uploading ? "Uploading…" : current ? "Replace" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

function EditorTab() {
  return (
    <div className="space-y-8">
      <BlockSection title="Paragraph">
        <ParagraphSettings />
      </BlockSection>
      <BlockSection title="Image">
        <ImageSettings />
      </BlockSection>
    </div>
  );
}

function ParagraphSettings() {
  const fontSize      = useSetting<string>(PARA_FONT_SIZE_KEY, PARA_FONT_SIZE_DEFAULT) ?? PARA_FONT_SIZE_DEFAULT;
  const fontWeight    = useSetting<string>(PARA_FONT_WEIGHT_KEY, PARA_FONT_WEIGHT_DEFAULT) ?? PARA_FONT_WEIGHT_DEFAULT;
  const lineHeight    = useSetting<string>(PARA_LINE_HEIGHT_KEY, PARA_LINE_HEIGHT_DEFAULT) ?? PARA_LINE_HEIGHT_DEFAULT;
  const letterSpacing = useSetting<string>(PARA_LETTER_SPACING_KEY, PARA_LETTER_SPACING_DEFAULT) ?? PARA_LETTER_SPACING_DEFAULT;
  const spacing       = useSetting<string>(PARA_SPACING_KEY, PARA_SPACING_DEFAULT) ?? PARA_SPACING_DEFAULT;

  return (
    <div className="space-y-5">
      <OptionGroup
        label="Font size"
        value={fontSize}
        onChange={(v) => void setParaFontSize(v)}
        options={[
          { value: "14px", label: "14" },
          { value: "15px", label: "15" },
          { value: "16px", label: "16" },
          { value: "17px", label: "17" },
          { value: "18px", label: "18" },
        ]}
      />
      <OptionGroup
        label="Font weight"
        value={fontWeight}
        onChange={(v) => void setParaFontWeight(v)}
        options={[
          { value: "300", label: "Light" },
          { value: "400", label: "Regular" },
          { value: "500", label: "Medium" },
        ]}
      />
      <OptionGroup
        label="Line height"
        value={lineHeight}
        onChange={(v) => void setParaLineHeight(v)}
        options={[
          { value: "1.5", label: "Tight" },
          { value: "1.7", label: "Normal" },
          { value: "1.9", label: "Relaxed" },
        ]}
      />
      <OptionGroup
        label="Letter spacing"
        value={letterSpacing}
        onChange={(v) => void setParaLetterSpacing(v)}
        options={[
          { value: "-0.02em", label: "Tight" },
          { value: "0em",     label: "Normal" },
          { value: "0.03em",  label: "Wide" },
        ]}
      />
      <OptionGroup
        label="Paragraph spacing"
        value={spacing}
        onChange={(v) => void setParaSpacing(v)}
        options={[
          { value: "tight",   label: "Tight" },
          { value: "normal",  label: "Normal" },
          { value: "relaxed", label: "Relaxed" },
        ]}
      />
    </div>
  );
}

function ImageSettings() {
  const captionAlign = useSetting<string>(CAPTION_ALIGN_KEY, CAPTION_ALIGN_DEFAULT) ?? CAPTION_ALIGN_DEFAULT;
  const captionSize  = useSetting<string>(CAPTION_SIZE_KEY, CAPTION_SIZE_DEFAULT) ?? CAPTION_SIZE_DEFAULT;

  return (
    <div className="space-y-5">
      <OptionGroup
        label="Caption alignment"
        value={captionAlign}
        onChange={(v) => void setCaptionAlign(v)}
        options={[
          { value: "left",   label: "Left" },
          { value: "center", label: "Center" },
        ]}
      />
      <OptionGroup
        label="Caption size"
        value={captionSize}
        onChange={(v) => void setCaptionSize(v)}
        options={[
          { value: "0.75rem",  label: "Small" },
          { value: "0.875rem", label: "Medium" },
        ]}
      />
    </div>
  );
}

function BlockSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-secondary">{title}</div>
        <div className="flex-1 border-t border-secondary" />
      </div>
      {children}
    </div>
  );
}

function OptionGroup({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        {label}
      </div>
      <div className="flex gap-1 rounded-lg border border-secondary bg-secondary p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "flex-1 rounded-md px-3 py-1.5 text-sm transition",
              value === o.value
                ? "bg-primary text-primary shadow-xs ring-1 ring-secondary"
                : "text-secondary hover:text-primary",
            ].join(" ")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-tertiary">{hint}</p>}
    </div>
  );
}
