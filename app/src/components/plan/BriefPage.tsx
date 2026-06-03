// A brief is its own page, like a post: a BlockNote body editor in the main
// column and the brief "header" fields in a right side panel. Mock data only.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { useLiveQuery } from "dexie-react-hooks";
import { parseDate } from "@internationalized/date";
import { ArrowLeft, Link01, LinkExternal01, Plus } from "@untitledui/icons";
import { go } from "@/lib/route";
import { db } from "@/lib/db";
import { useTheme } from "@/lib/theme";
import { collectionDisplay } from "@/lib/collections";
import type { Collection } from "@/types";
import type { Brief, BriefStatus } from "@/lib/plan/types";
import { BRIEF_STATUS_ORDER, statusMeta } from "@/lib/plan/types";
import { MOCK_ASSIGNEES, MOCK_TEMPLATES, mockBriefs } from "@/lib/plan/mock";
import { StatusBadge } from "@/components/plan/bits";
import { Button } from "@/components/base/buttons/button";
import { BadgeWithButton } from "@/components/base/badges/badges";
import { Select } from "@/components/base/select/select";
import { Input } from "@/components/base/input/input";
import { DatePicker } from "@/components/application/date-picker/date-picker";

const NONE = "__none__";

function newBriefSeed(plannedDate: string | null = null): Brief {
  const now = Date.now();
  return {
    id: "new",
    title: "",
    status: "backlog",
    assigneeId: null,
    plannedDate,
    tags: [],
    templateId: null,
    collectionName: null,
    body: "",
    checks: {},
    postId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function BriefPage({ id }: { id: string }) {
  const briefs = useMemo(() => mockBriefs(), []);
  const isNew = id === "new" || id.startsWith("new:");
  const presetDate = id.startsWith("new:") ? id.slice(4) : null;
  const source = isNew ? null : (briefs.find((b) => b.id === id) ?? null);

  if (!isNew && !source) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-tertiary">
        Brief not found.
      </div>
    );
  }

  return <BriefView initial={source ?? newBriefSeed(presetDate)} isNew={isNew} />;
}

function BriefView({ initial, isNew }: { initial: Brief; isNew: boolean }) {
  const editor = useCreateBlockNote();
  const [theme] = useTheme();
  const collectionRows = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );

  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<BriefStatus>(initial.status);
  const [assigneeId, setAssigneeId] = useState<string | null>(initial.assigneeId);
  const [collectionName, setCollectionName] = useState<string | null>(initial.collectionName);
  const [plannedDate, setPlannedDate] = useState<string | null>(initial.plannedDate);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(initial.templateId);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !editor) return;
    seeded.current = true;
    if (initial.body) {
      void (async () => {
        const blocks = await editor.tryParseMarkdownToBlocks(initial.body);
        editor.replaceBlocks(editor.document, blocks);
      })();
    }
  }, [editor, initial.body]);

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft("");
  };

  const statusItems = BRIEF_STATUS_ORDER.map((s) => ({ id: s, label: statusMeta(s).label }));
  const assigneeItems = [
    { id: NONE, label: "Unassigned" },
    ...MOCK_ASSIGNEES.map((a) => ({ id: a.id, label: a.name })),
  ];
  const templateItems = [
    { id: NONE, label: "No template" },
    ...MOCK_TEMPLATES.map((t) => ({ id: t.id, label: t.name })),
  ];
  const collectionItems = collectionRows.map((c) => {
    const d = collectionDisplay(c.name, collectionRows);
    return { id: c.name, label: d.emoji ? `${d.emoji}  ${d.label || c.name}` : c.name };
  });

  const hasChecks = Boolean(
    initial.checks.minWords || initial.checks.maxWords || initial.checks.requiredKeywords?.length,
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
          <StatusBadge status={status} />
        </div>

        <div className="mx-auto w-full max-w-[760px] px-10 pt-12 pb-24">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            selectedKey={status}
            onSelectionChange={(k) => setStatus(k as BriefStatus)}
            items={statusItems}
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
        </FieldStack>

        <FieldStack label="Collection">
          <Select
            size="sm"
            selectedKey={collectionName}
            onSelectionChange={(k) => setCollectionName(k ? String(k) : null)}
            items={collectionItems}
            placeholder="Choose collection"
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
          <p className="mt-1.5 text-[11px] text-quaternary">
            The post this brief produces is created here. The brief itself isn't in the collection.
          </p>
        </FieldStack>

        <FieldStack label="Assignee">
          <Select
            size="sm"
            selectedKey={assigneeId ?? NONE}
            onSelectionChange={(k) => setAssigneeId(k === NONE ? null : String(k))}
            items={assigneeItems}
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
        </FieldStack>

        <FieldStack label="Due date">
          <DatePicker
            value={plannedDate ? parseDate(plannedDate) : null}
            onChange={(v) => setPlannedDate(v ? v.toString() : null)}
          />
          <p className="mt-1.5 text-[11px] text-quaternary">Projected publish date.</p>
        </FieldStack>

        <FieldStack label="Template">
          <Select
            size="sm"
            selectedKey={templateId ?? NONE}
            onSelectionChange={(k) => setTemplateId(k === NONE ? null : String(k))}
            items={templateItems}
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
        </FieldStack>

        <FieldStack label="Tags">
          {tags.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <BadgeWithButton
                  key={t}
                  color="gray"
                  type="color"
                  size="sm"
                  buttonLabel={`Remove ${t}`}
                  onButtonClick={() => setTags(tags.filter((x) => x !== t))}
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
              {initial.checks.minWords ? (
                <span>Target: at least {initial.checks.minWords} words</span>
              ) : null}
              {initial.checks.maxWords ? <span>Max: {initial.checks.maxWords} words</span> : null}
              {initial.checks.requiredKeywords?.length ? (
                <span>Keywords: {initial.checks.requiredKeywords.join(", ")}</span>
              ) : null}
              <span className="text-quaternary">Compliance checking comes later (P5).</span>
            </div>
          </FieldStack>
        )}

        <FieldStack label="Linked post">
          {initial.postId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-primary p-2.5 ring-1 ring-secondary ring-inset">
              <span className="flex items-center gap-2 text-secondary">
                <Link01 className="size-4 text-fg-quaternary" /> Post #{initial.postId}
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
          {isNew ? "New brief (mock), not saved yet." : "Mock data, edits aren't saved yet."}
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
