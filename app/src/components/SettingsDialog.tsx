import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { File02, Globe01, PenTool01, Plus, Trash01, Upload01, User01, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { db } from "@/lib/db";
import { useSetting, setSetting, useSettingsVersion } from "@/lib/settings";
import { uploadFile } from "@/lib/uploads";
import type { BriefChecks, BriefTemplate } from "@/lib/plan/types";
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedTemplatesIfEmpty,
} from "@/lib/plan/templates";
import {
  type BlockKey,
  getBlockProp,
  setBlockProp,
  CAPTION_ALIGN_KEY, CAPTION_SIZE_KEY, CAPTION_ALIGN_DEFAULT, CAPTION_SIZE_DEFAULT,
  setCaptionAlign, setCaptionSize,
} from "@/lib/editorStyles";

interface Props {
  onClose: () => void;
}

type Tab = "author" | "site" | "editor" | "templates";

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
          <TabButton active={tab === "templates"} onClick={() => setTab("templates")} icon={<File02 className="size-4" />}>
            Templates
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
            {tab === "templates" && <TemplatesTab />}
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
        <BlockTypeSettings block="paragraph" />
      </BlockSection>
      <BlockSection title="H1">
        <BlockTypeSettings block="h1" />
      </BlockSection>
      <BlockSection title="H2">
        <BlockTypeSettings block="h2" />
      </BlockSection>
      <BlockSection title="H3">
        <BlockTypeSettings block="h3" />
      </BlockSection>
      <BlockSection title="Quote">
        <BlockTypeSettings block="quote" />
      </BlockSection>
      <BlockSection title="Image">
        <ImageSettings />
      </BlockSection>
    </div>
  );
}

function BlockTypeSettings({ block }: { block: BlockKey }) {
  useSettingsVersion();
  return (
    <div className="space-y-3">
      <NumberField
        label="Font size"
        value={getBlockProp(block, "fontSize")}
        onChange={(v) => void setBlockProp(block, "fontSize", v)}
        min={8} max={72} step={1} unit="px"
      />
      <NumberField
        label="Font weight"
        value={getBlockProp(block, "fontWeight")}
        onChange={(v) => void setBlockProp(block, "fontWeight", v)}
        min={100} max={900} step={100}
      />
      <NumberField
        label="Line height"
        value={getBlockProp(block, "lineHeight")}
        onChange={(v) => void setBlockProp(block, "lineHeight", v)}
        min={0.5} max={3} step={0.05}
      />
      <NumberField
        label="Letter spacing"
        value={getBlockProp(block, "letterSpacing")}
        onChange={(v) => void setBlockProp(block, "letterSpacing", v)}
        min={-0.1} max={0.2} step={0.005} unit="em"
      />
      <NumberField
        label="Paragraph spacing"
        value={getBlockProp(block, "spacing")}
        onChange={(v) => void setBlockProp(block, "spacing", v)}
        min={0} max={48} step={1} unit="px"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-secondary">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-20 rounded-md bg-primary px-2 py-1 text-right text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 focus:ring-2 focus:ring-brand"
        />
        {unit && <span className="w-5 text-xs text-quaternary">{unit}</span>}
      </div>
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

function TemplatesTab() {
  useEffect(() => {
    void seedTemplatesIfEmpty();
  }, []);

  const templates = useLiveQuery(() => db.briefTemplates.toArray(), [], [] as BriefTemplate[]);
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-tertiary">
          Templates pre-fill a new brief. Picking one on a brief seeds an empty body and its
          checks.
        </p>
        <Button
          size="sm"
          color="secondary"
          iconLeading={Plus}
          onClick={() => void createTemplate({ name: "New template" })}
        >
          New
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-secondary px-4 py-10 text-center text-xs text-quaternary">
          No templates yet.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((t) => (
            <TemplateCard key={t.id} tpl={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ tpl }: { tpl: BriefTemplate }) {
  const [name, setName] = useState(tpl.name);
  const [body, setBody] = useState(tpl.body);
  const [minWords, setMinWords] = useState(tpl.checks.minWords?.toString() ?? "");
  const [maxWords, setMaxWords] = useState(tpl.checks.maxWords?.toString() ?? "");
  const [keywords, setKeywords] = useState((tpl.checks.requiredKeywords ?? []).join(", "));

  // Debounced persist on any field change. Skip the initial mount so rendering a
  // seeded (clean) template doesn't immediately mark it dirty.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const checks: BriefChecks = {};
      const mn = parseInt(minWords, 10);
      const mx = parseInt(maxWords, 10);
      if (!Number.isNaN(mn)) checks.minWords = mn;
      if (!Number.isNaN(mx)) checks.maxWords = mx;
      const kw = keywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (kw.length) checks.requiredKeywords = kw;
      void updateTemplate(tpl.id, { name, body, checks });
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [name, body, minWords, maxWords, keywords, tpl.id]);

  return (
    <div className="space-y-3 rounded-lg border border-secondary bg-primary p-4">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-primary outline-none placeholder:text-quaternary"
        />
        <button
          aria-label={`Delete ${tpl.name || "template"}`}
          onClick={() => void deleteTemplate(tpl.id)}
          className="rounded-md p-1.5 text-quaternary transition hover:bg-tertiary hover:text-primary"
        >
          <Trash01 className="size-4" />
        </button>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
          Body skeleton
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="Markdown seeded into the brief body…"
          className="w-full resize-y rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 ease-linear focus:ring-2 focus:ring-inset focus:ring-brand"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CheckField label="Min words" value={minWords} onChange={setMinWords} numeric />
        <CheckField label="Max words" value={maxWords} onChange={setMaxWords} numeric />
        <CheckField label="Keywords" value={keywords} onChange={setKeywords} placeholder="a, b" />
      </div>
    </div>
  );
}

function CheckField({
  label,
  value,
  onChange,
  numeric,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        {label}
      </div>
      <input
        type={numeric ? "number" : "text"}
        value={value}
        min={numeric ? 0 : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-secondary px-2 py-1.5 text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 focus:ring-2 focus:ring-brand"
      />
    </label>
  );
}
