// A brief is its own page, like a post: a BlockNote body editor in the main
// column and the brief "header" fields in a right side panel. Backed by Dexie
// (lib/plan/briefs); edits persist and sync.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { parseDate } from "@internationalized/date";
import { ArrowLeft, Link01, LinkExternal01, Plus } from "@untitledui/icons";
import { go } from "@/lib/route";
import { db } from "@/lib/db";
import { useTheme } from "@/lib/theme";
import { collectionDisplay } from "@/lib/collections";
import { updateBrief, seedBriefsIfEmpty } from "@/lib/plan/briefs";
import type { Collection } from "@/types";
import type { Brief, BriefStatus } from "@/lib/plan/types";
import { BRIEF_STATUS_ORDER, statusMeta } from "@/lib/plan/types";
import { MOCK_ASSIGNEES, MOCK_TEMPLATES, assigneeById } from "@/lib/plan/mock";
import { StatusBadge } from "@/components/plan/bits";
import { Button } from "@/components/base/buttons/button";
import { BadgeWithButton } from "@/components/base/badges/badges";
import { Select } from "@/components/base/select/select";
import { Input } from "@/components/base/input/input";
import { DatePicker } from "@/components/application/date-picker/date-picker";

const NONE = "__none__";

export function BriefPage({ id }: { id: string }) {
  useEffect(() => {
    void seedBriefsIfEmpty();
  }, []);

  const brief = useLiveQuery(() => db.briefs.get(id), [id]);

  if (brief === undefined) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-tertiary">Loading…</div>
    );
  }

  return <BriefView key={brief.id} brief={brief} />;
}

function BriefView({ brief }: { brief: Brief }) {
  const editor = useCreateBlockNote();
  const [theme] = useTheme();
  const [tagDraft, setTagDraft] = useState("");
  const collectionRows = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );

  const persist = (patch: Partial<Brief>) => void updateBrief(brief.id, patch);

  // Seed the body editor once from the brief.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !editor) return;
    seeded.current = true;
    if (brief.body) {
      void (async () => {
        const blocks = await editor.tryParseMarkdownToBlocks(brief.body);
        editor.replaceBlocks(editor.document, blocks);
      })();
    }
  }, [editor, brief.body]);

  // Persist body changes (debounced).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor) return;
    const unsub = editor.onChange(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const md = await editor.blocksToMarkdownLossy();
        void updateBrief(brief.id, { body: md });
      }, 400);
    });
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (typeof unsub === "function") unsub();
    };
  }, [editor, brief.id]);

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, "");
    if (t && !brief.tags.includes(t)) persist({ tags: [...brief.tags, t] });
    setTagDraft("");
  };

  const statusItems = BRIEF_STATUS_ORDER.map((s) => ({ id: s, label: statusMeta(s).label }));
  const templateItems = [
    { id: NONE, label: "No template" },
    ...MOCK_TEMPLATES.map((t) => ({ id: t.id, label: t.name })),
  ];
  const collectionItems = collectionRows.map((c) => {
    const d = collectionDisplay(c.name, collectionRows);
    return { id: c.name, label: d.emoji ? `${d.emoji}  ${d.label || c.name}` : c.name };
  });
  const availableAssignees = MOCK_ASSIGNEES.filter((a) => !brief.assigneeIds.includes(a.id));

  const hasChecks = Boolean(
    brief.checks.minWords || brief.checks.maxWords || brief.checks.requiredKeywords?.length,
  );

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-secondary bg-primary/85 px-6 py-3 text-xs text-tertiary backdrop-blur">
          <button
            onClick={() => go({ view: "plan" })}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-primary_hover hover:text-secondary"
          >
            <ArrowLeft className="size-3.5" />
            Planning
          </button>
          <StatusBadge status={brief.status} />
        </div>

        <div className="mx-auto w-full max-w-[760px] px-10 pt-12 pb-24">
          <input
            value={brief.title}
            onChange={(e) => persist({ title: e.target.value })}
            placeholder="Brief title"
            className="w-full bg-transparent font-title text-4xl leading-tight text-primary outline-none placeholder:text-quaternary"
          />
          <p className="mt-2 text-sm text-quaternary">
            The brief is the task. The post is written separately and linked, never in this body.
          </p>
          <div className="mt-8">
            <BlockNoteView editor={editor} theme={theme} />
          </div>
        </div>
      </main>

      <aside className="flex h-full w-[320px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-secondary bg-secondary px-5 py-6 text-sm">
        <FieldStack label="Status">
          <Select
            size="sm"
            selectedKey={brief.status}
            onSelectionChange={(k) => persist({ status: k as BriefStatus })}
            items={statusItems}
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
        </FieldStack>

        <FieldStack label="Collection">
          <Select
            size="sm"
            selectedKey={brief.collectionName}
            onSelectionChange={(k) => persist({ collectionName: k ? String(k) : null })}
            items={collectionItems}
            placeholder="Choose collection"
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
          <p className="mt-1.5 text-[11px] text-quaternary">
            The post this brief produces is created here. The brief itself isn't in the collection.
          </p>
        </FieldStack>

        <FieldStack label="Assignees">
          {brief.assigneeIds.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {brief.assigneeIds.map((aid) => {
                const a = assigneeById(aid);
                return (
                  <BadgeWithButton
                    key={aid}
                    color="gray"
                    type="color"
                    size="sm"
                    buttonLabel={`Remove ${a?.name ?? aid}`}
                    onButtonClick={() =>
                      persist({ assigneeIds: brief.assigneeIds.filter((x) => x !== aid) })
                    }
                  >
                    {a?.name ?? aid}
                  </BadgeWithButton>
                );
              })}
            </div>
          )}
          <Select
            size="sm"
            selectedKey={null}
            placeholder={availableAssignees.length ? "Add assignee" : "All added"}
            isDisabled={availableAssignees.length === 0}
            onSelectionChange={(k) => {
              if (k) persist({ assigneeIds: [...brief.assigneeIds, String(k)] });
            }}
            items={availableAssignees.map((a) => ({ id: a.id, label: a.name }))}
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
        </FieldStack>

        <FieldStack label="Due date">
          <DatePicker
            value={brief.plannedDate ? parseDate(brief.plannedDate) : null}
            onChange={(v) => persist({ plannedDate: v ? v.toString() : null })}
          />
          <p className="mt-1.5 text-[11px] text-quaternary">Projected publish date.</p>
        </FieldStack>

        <FieldStack label="Template">
          <Select
            size="sm"
            selectedKey={brief.templateId ?? NONE}
            onSelectionChange={(k) => persist({ templateId: k === NONE ? null : String(k) })}
            items={templateItems}
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
        </FieldStack>

        <FieldStack label="Tags">
          {brief.tags.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {brief.tags.map((t) => (
                <BadgeWithButton
                  key={t}
                  color="gray"
                  type="color"
                  size="sm"
                  buttonLabel={`Remove ${t}`}
                  onButtonClick={() => persist({ tags: brief.tags.filter((x) => x !== t) })}
                >
                  #{t}
                </BadgeWithButton>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
          >
            <Input
              size="sm"
              aria-label="Add tag"
              value={tagDraft}
              onChange={setTagDraft}
              placeholder="Add tag, press Enter"
            />
          </form>
        </FieldStack>

        {hasChecks && (
          <FieldStack label="Checks">
            <div className="flex flex-col gap-1 rounded-lg bg-primary p-2.5 text-xs text-tertiary ring-1 ring-secondary ring-inset">
              {brief.checks.minWords ? <span>Target: at least {brief.checks.minWords} words</span> : null}
              {brief.checks.maxWords ? <span>Max: {brief.checks.maxWords} words</span> : null}
              {brief.checks.requiredKeywords?.length ? (
                <span>Keywords: {brief.checks.requiredKeywords.join(", ")}</span>
              ) : null}
              <span className="text-quaternary">Compliance checking comes later (P5).</span>
            </div>
          </FieldStack>
        )}

        <FieldStack label="Linked post">
          {brief.postId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-primary p-2.5 ring-1 ring-secondary ring-inset">
              <span className="flex items-center gap-2 text-secondary">
                <Link01 className="size-4 text-fg-quaternary" /> Post #{brief.postId}
              </span>
              <Button size="sm" color="secondary" iconLeading={LinkExternal01}>
                Open
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button size="sm" color="secondary" iconLeading={Plus}>
                Add post
              </Button>
              <Button size="sm" color="secondary" iconLeading={Link01}>
                Link existing
              </Button>
            </div>
          )}
        </FieldStack>

        <div className="mt-auto border-t border-secondary pt-3 text-[11px] text-quaternary">
          Edits save automatically.
        </div>
      </aside>
    </div>
  );
}

function FieldStack({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-secondary">{label}</div>
      {children}
    </div>
  );
}
