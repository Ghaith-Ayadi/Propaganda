// One flag: what the content says, what it disagrees with, the actual fix, and
// the other ways to close it. "It isn't inconsistent" opens a pushback the
// Guardian rules on; "True, but not worth fixing" closes it and still counts
// against the content grade. Content that can't change (a sent newsletter, a
// posted tweet) gets no fix and is left out of the grade by type.

import { useState } from "react";
import { Check, Edit05, Lock01, Shield01, XClose } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ObjectIcon, objectLabel } from "@/components/shared/ObjectIcon";
import { reportError } from "@/lib/telemetry";
import { ClaimBlock, ObjectLine, OpenOriginal, PassageText, SourceBlock, TextArea, originalHref } from "./bits";
import type { Flag, InboxSource } from "./data";

export function FlagDetail({ flag, source }: { flag: Flag; source: InboxSource }) {
  const [mode, setMode] = useState<"idle" | "edit" | "contest">("idle");
  const [replacement, setReplacement] = useState(flag.fix?.replacement ?? "");
  const [argument, setArgument] = useState("");
  const href = originalHref(flag.object);

  const run = (p: Promise<void>) => p.catch((err) => reportError("Inbox.flag", err));

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <ObjectLine object={flag.object} />
          <h2 className="mt-2 font-title text-2xl leading-tight text-primary">{flag.object.title}</h2>
          <p className="mt-1 text-sm text-tertiary">
            {flag.topic} · raised {flag.raised} · confidence {Math.round(flag.confidence * 100)}%
          </p>
        </div>
        {href && (
          <Button size="sm" color="secondary" href={href}>
            {flag.object.postId ? "Open in editor" : "View live"}
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SourceBlock
          icon={<ObjectIcon kind={flag.object.kind} className="size-4" />}
          heading={`This ${objectLabel[flag.object.kind].toLowerCase()} says`}
          action={<OpenOriginal object={flag.object} />}
          footer={flag.says.section && `Section: ${flag.says.section}`}
        >
          <PassageText passage={flag.says} />
        </SourceBlock>

        {flag.against.kind === "claim" ? (
          <ClaimBlock claim={flag.against.claim} heading="Contradicts the knowledge base" />
        ) : (
          <SourceBlock
            icon={<ObjectIcon kind={flag.against.object.kind} className="size-4" />}
            heading={`Contradicts another ${objectLabel[flag.against.object.kind].toLowerCase()}`}
            action={<OpenOriginal object={flag.against.object} />}
            footer={
              <>
                {flag.against.passage.section && <span className="block">{flag.against.passage.section}</span>}
                <span className="mt-1 block">
                  “{flag.against.object.title}”, {flag.against.object.state}. {flag.against.note}
                </span>
              </>
            }
          >
            <PassageText passage={flag.against.passage} mark="plain" />
          </SourceBlock>
        )}
      </div>

      {flag.status === "contesting" && (
        <div className="flex items-center gap-3 rounded-xl border border-secondary bg-secondary px-5 py-4 text-sm text-secondary">
          <Shield01 className="size-5 text-fg-quaternary" />
          The Guardian is reading your argument. The flag stays open until it rules.
        </div>
      )}

      {flag.status === "rejected" && flag.guardian && mode !== "edit" && mode !== "contest" && (
        <section className="rounded-xl border border-error_subtle bg-error-primary px-5 py-4">
          <div className="flex items-center gap-2">
            <Shield01 className="size-5 text-fg-error-secondary" />
            <span className="text-md text-primary">The Guardian</span>
            <Badge type="pill-color" color="error" size="sm">
              <XClose className="mr-1 size-3" /> Rejected
            </Badge>
          </div>
          <p className="mt-3 max-w-2xl text-md leading-7 text-secondary">{flag.guardian.argument}</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" color="secondary" onClick={() => setMode("contest")}>
              Argue again
            </Button>
          </div>
        </section>
      )}

      {flag.cantFix ? (
        <div className="flex items-start gap-3 rounded-xl border border-secondary px-5 py-4">
          <Lock01 className="mt-0.5 size-5 text-fg-quaternary" />
          <div className="text-sm text-secondary">
            <p className="text-md text-primary">Can't be fixed</p>
            <p className="mt-1">
              A {objectLabel[flag.object.kind].toLowerCase()} can't change once it's out, so this stays out of the content grade.
              It's here so the next one gets it right.
            </p>
          </div>
        </div>
      ) : (
        flag.fix &&
        flag.status !== "contesting" &&
        mode !== "contest" && (
          <section className="rounded-xl border border-primary px-5 py-4 shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-md text-primary">The fix</span>
              <span className="text-sm text-tertiary">Applied as a suggestion in the editor</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-secondary">
                <Edit05 className="size-4 text-fg-quaternary" /> Proposed edit
              </span>
              <OpenOriginal object={flag.object} />
            </div>
            {mode === "edit" ? (
              <div className="mt-3">
                <TextArea label="Your version of the sentence" value={replacement} onChange={setReplacement} autoFocus />
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-secondary px-4 py-3 text-md leading-7 text-secondary">
                {flag.says.before && <>…{flag.says.before}</>}
                <del className="text-error-primary decoration-1">{flag.says.quote}</del>{" "}
                <ins className="text-success-primary no-underline">{replacement}</ins>
                {flag.says.after && <>{flag.says.after}…</>}
              </p>
            )}
            {flag.says.section && <p className="mt-2 text-sm text-tertiary">Section: {flag.says.section}</p>}
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                color="primary"
                iconLeading={Check}
                isDisabled={!replacement.trim()}
                onClick={() => void run(source.applyFix(flag.id, replacement.trim()))}
              >
                Apply the fix
              </Button>
              {mode === "edit" ? (
                <Button size="sm" color="secondary" onClick={() => { setReplacement(flag.fix!.replacement); setMode("idle"); }}>
                  Cancel
                </Button>
              ) : (
                <Button size="sm" color="secondary" onClick={() => setMode("edit")}>
                  Edit it
                </Button>
              )}
            </div>
          </section>
        )
      )}

      {mode === "contest" && (
        <section className="rounded-xl border border-primary px-5 py-4 shadow-xs">
          <p className="text-md text-primary">Why both can be true</p>
          <p className="mt-1 text-sm text-tertiary">
            One or two sentences: a date, a scope, a customer segment. The Guardian decides, not you. A thin case gets admitted as
            contested, which closes the flag and lowers the knowledge base grade.
          </p>
          <div className="mt-3">
            <TextArea
              label="Your argument"
              value={argument}
              onChange={setArgument}
              autoFocus
              placeholder="The post was written before the rename on 1 September, and…"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              color="primary"
              isDisabled={!argument.trim()}
              onClick={() => {
                void run(source.contest(flag.id, argument.trim()));
                setMode("idle");
                setArgument("");
              }}
            >
              Send to the Guardian
            </Button>
            <Button size="sm" color="secondary" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {flag.status !== "contesting" && mode !== "contest" && (
        <section>
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-tertiary uppercase">Or close it another way</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CloseCard
              title="It isn't inconsistent"
              body="Argue why both can be true. The Guardian decides, not you."
              onPress={() => setMode("contest")}
            />
            {flag.cantFix && flag.object.kind === "newsletter" ? (
              <CloseCard
                title="Noted"
                body="Closes the task. It stays out of the grade either way."
                onPress={() => void run(source.closeFlag(flag.id, "noted"))}
              />
            ) : flag.cantFix ? (
              <CloseCard
                title="We took it down"
                body="The post is deleted, so it leaves the grade."
                onPress={() => void run(source.closeFlag(flag.id, "retracted"))}
              />
            ) : (
              <CloseCard
                title="True, but not worth fixing"
                body="Closes the task. Still counts against your content grade."
                onPress={() => void run(source.closeFlag(flag.id, "wont_fix"))}
              />
            )}
          </div>
        </section>
      )}
    </article>
  );
}

function CloseCard({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-xl border border-secondary bg-primary px-5 py-4 text-left outline-focus-ring transition-colors hover:bg-primary_hover focus-visible:outline-2"
    >
      <span className="block text-md text-primary">{title}</span>
      <span className="mt-1 block text-sm text-tertiary">{body}</span>
    </button>
  );
}
