// "I already have a plan": paste it, or drop the files (PDF, Word, Markdown,
// spreadsheets, images such as a whiteboard photo). The Strategist reads it with
// the onboarding answers and marks every proposed item From your plan, Changed
// or Added. Section 6 of agents/strategist-cold-start-and-pacing.md.

import { useEffect, useState } from "react";
import { Button as AriaButton, DropZone, FileTrigger, Label, TextArea, TextField } from "react-aria-components";
import { File04, Image01, Trash01, UploadCloud02 } from "@untitledui/icons";
import type { PlanFile } from "@/lib/goals/types";
import { goalsActions, goalsArePlaceholder, usePlanDrop } from "@/lib/goals/useGoals";
import { kindOf } from "@/lib/goals/placeholder";
import { shortDate } from "@/lib/goals/quarter";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { reportError } from "@/lib/telemetry";
import { Card } from "./bits";
import { cx } from "@/utils/cx";

const ACCEPT = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];
const ACCEPT_EXT = /\.(pdf|docx?|odt|rtf|md|markdown|txt|csv|xlsx?|ods|jpe?g|png|webp|heic)$/i;
const MAX_BYTES = 25 * 1024 * 1024;

function accepted(f: File): boolean {
  return (ACCEPT.includes(f.type) || ACCEPT_EXT.test(f.name)) && f.size <= MAX_BYTES;
}

/** The plan drop's unsaved state: pasted text plus files not yet handed over. */
export function usePlanDraft() {
  const drop = usePlanDrop();
  const [text, setText] = useState(drop.text);
  const [pending, setPending] = useState<File[]>([]);
  useEffect(() => setText(drop.text), [drop.text]);

  const add = (files: File[]) => {
    const ok = files.filter(accepted);
    if (ok.length < files.length) {
      toast.add({ type: "error", title: "Some files were skipped", description: "PDF, Word, Markdown, spreadsheets and images, up to 25 MB each." });
    }
    setPending((p) => [...p, ...ok]);
  };
  const remove = (i: number) => setPending((p) => p.filter((_, k) => k !== i));
  const dirty = text !== drop.text || pending.length > 0;
  /** Hands it to the Strategist. Throws on failure; the caller reports it. */
  const save = async () => {
    if (!dirty) return;
    await goalsActions.savePlanDrop(text, pending);
    setPending([]);
  };
  return { drop, text, setText, pending, add, remove, dirty, save };
}

export type PlanDraft = ReturnType<typeof usePlanDraft>;

/** The fields alone: a text area, the drop zone and the file list. */
export function PlanDropFields({ draft, compact = false, label = "Paste your plan, notes, a list of titles, anything" }: { draft: PlanDraft; compact?: boolean; label?: string }) {
  const { drop, text, setText, pending, add, remove } = draft;
  return (
    <div>
      <TextField value={text} onChange={setText} className="flex flex-col gap-1.5">
        <Label className="text-sm font-medium text-secondary">{label}</Label>
        <TextArea
          rows={compact ? 4 : 7}
          className="w-full resize-y rounded-lg bg-primary px-3.5 py-3 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
          placeholder={"Q4 ideas:\n- Close checklist series\n- Customer story with Northwind"}
        />
      </TextField>

      <DropZone
        onDrop={async (e) => {
          const files = await Promise.all(
            e.items.filter((i): i is Extract<typeof i, { kind: "file" }> => i.kind === "file").map((i) => i.getFile()),
          );
          add(files);
        }}
        className={({ isDropTarget }) =>
          cx(
            "mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary px-4 text-center transition",
            compact ? "py-4" : "py-6",
            isDropTarget && "border-brand bg-brand-primary_alt",
          )
        }
      >
        <UploadCloud02 className="size-6 text-fg-quaternary" aria-hidden />
        <p className="text-sm text-secondary">
          Drop files here, or{" "}
          <FileTrigger allowsMultiple acceptedFileTypes={ACCEPT} onSelect={(list) => list && add(Array.from(list))}>
            <AriaButton className="font-medium text-brand-secondary outline-none hover:underline focus-visible:underline">choose files</AriaButton>
          </FileTrigger>
        </p>
        <p className="text-xs text-quaternary">PDF, Word, Markdown, spreadsheets, and images such as a whiteboard photo or a screenshot of your board.</p>
      </DropZone>

      {(drop.files.length > 0 || pending.length > 0) && (
        <ul className="mt-4 divide-y divide-secondary rounded-xl ring-1 ring-secondary ring-inset">
          {drop.files.map((f) => (
            <FileRow key={f.id} name={f.name} size={f.size} kind={f.kind} note={`Added ${shortDate(f.uploadedAt)}`} onRemove={() => void goalsActions.removePlanFile(f.id)} />
          ))}
          {pending.map((f, i) => (
            <FileRow key={`p${i}`} name={f.name} size={f.size} kind={kindOf(f)} note="Not saved yet" onRemove={() => remove(i)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlanDrop({ compact = false }: { compact?: boolean }) {
  const draft = usePlanDraft();
  const { drop, dirty } = draft;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await draft.save();
      toast.add({ type: "success", title: "The Strategist will read this", description: "It goes into the next proposal, item by item." });
    } catch (err) {
      reportError("goals.planDrop", err);
      toast.add({ type: "error", title: "Couldn't save your plan", description: "Try again in a moment." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Your plan"
      subtitle="Already have a plan? Paste it or drop the files. Every item you give us shows up in the proposal: kept, changed with a reason, or moved to the backlog. Never dropped silently."
    >
      <PlanDropFields draft={draft} compact={compact} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-quaternary">
          {drop.readAt ? `The Strategist read this on ${shortDate(drop.readAt)}.` : drop.text || drop.files.length ? "Saved. The Strategist reads it in the next proposal." : ""}
          {goalsArePlaceholder && " Sample data: files stay in this browser tab."}
        </p>
        <Button size="sm" color="primary" isDisabled={!dirty || saving} isLoading={saving} onClick={() => void save()}>
          Give it to the Strategist
        </Button>
      </div>
    </Card>
  );
}

function FileRow({ name, size, kind, note, onRemove }: { name: string; size: number; kind: PlanFile["kind"]; note: string; onRemove: () => void }) {
  const Icon = kind === "image" ? Image01 : File04;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon className="size-5 shrink-0 text-fg-quaternary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-primary">{name}</span>
        <span className="block text-xs text-tertiary">
          {size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`} · {note}
        </span>
      </span>
      <Button size="sm" color="tertiary" iconLeading={Trash01} aria-label={`Remove ${name}`} onClick={onRemove} />
    </li>
  );
}
