// One flag: the original paragraph, what it disagrees with, the suggested
// update, and the other ways to close it. "It isn't inconsistent" opens a
// pushback the Guardian rules on; "True, but not worth fixing" closes it and
// still counts against the content grade. Content that can't change (a sent
// newsletter, a posted tweet) gets no update and is left out of the grade.

import { useState } from "react";
import { Check, Lock01, Shield01, XClose } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardFooter, CardHeader, CardSection, MetaList } from "@/components/shared/Card";
import { ObjectIcon, objectLabel } from "@/components/shared/ObjectIcon";
import { reportError } from "@/lib/telemetry";
import { ClaimText, OriginalLink, PassageText, Quote, TextArea, UrgentChip, originalHref } from "./bits";
import type { Flag, InboxSource } from "./data";

export function FlagDetail({ flag, source }: { flag: Flag; source: InboxSource }) {
  const [mode, setMode] = useState<"idle" | "edit" | "contest">("idle");
  const [replacement, setReplacement] = useState(flag.fix?.replacement ?? "");
  const [argument, setArgument] = useState("");
  const href = originalHref(flag.object);
  const kind = objectLabel[flag.object.kind];

  const run = (p: Promise<void>) => p.catch((err) => reportError("Inbox.flag", err));
  const settled = flag.status !== "contesting" && mode !== "contest";

  return (
    <Card>
      <CardHeader
        icon={<ObjectIcon kind={flag.object.kind} className="size-5" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {flag.object.title}
            {flag.urgency === "high" && <UrgentChip />}
          </span>
        }
        description={flag.topic}
        actions={
          href && (
            <Button size="sm" color="secondary" href={href}>
              {flag.object.postId ? "Open in editor" : "View live"}
            </Button>
          )
        }
      />
      <CardBody>
        <CardSection label={<OriginalLink object={flag.object} label="Original text" />}>
          <PassageText passage={flag.says} />
        </CardSection>

        {flag.against.kind === "claim" ? (
          <CardSection label="Knowledge base item">
            <ClaimText claim={flag.against.claim} />
          </CardSection>
        ) : (
          <CardSection label={<OriginalLink object={flag.against.object} label={`Other ${objectLabel[flag.against.object.kind].toLowerCase()}`} />}>
            <Quote>
              <PassageText passage={flag.against.passage} mark="plain" />
              <p className="mt-1 text-sm text-tertiary">
                {flag.against.object.title}, {flag.against.object.state}. {flag.against.note}
              </p>
            </Quote>
          </CardSection>
        )}

        {flag.status === "contesting" && (
          <div className="flex items-center gap-3 rounded-lg bg-secondary px-4 py-3 text-sm text-secondary">
            <Shield01 className="size-5 text-fg-quaternary" />
            The Guardian is reading your argument. The flag stays open until it rules.
          </div>
        )}

        {flag.status === "rejected" && flag.guardian && mode === "idle" && (
          <CardSection
            label={
              <span className="flex items-center gap-2">
                The Guardian
                <Badge type="pill-color" color="error" size="sm">
                  <XClose className="mr-1 size-3" /> Rejected
                </Badge>
              </span>
            }
            action={
              <Button size="sm" color="link-gray" onClick={() => setMode("contest")}>
                Argue again
              </Button>
            }
          >
            <p className="text-md leading-7 text-secondary">{flag.guardian.argument}</p>
          </CardSection>
        )}

        {flag.cantFix ? (
          <div className="flex items-start gap-3 rounded-lg bg-secondary px-4 py-3 text-sm text-secondary">
            <Lock01 className="mt-0.5 size-4 shrink-0 text-fg-quaternary" />
            A {kind.toLowerCase()} can't change once it's out, so this stays out of the content grade. It's here so the next one gets it
            right.
          </div>
        ) : (
          flag.fix &&
          settled && (
            <Card className="shadow-none">
              <CardHeader
                title="Suggested update"
                actions={
                  <>
                    {mode === "edit" ? (
                      <Button
                        size="sm"
                        color="secondary"
                        onClick={() => {
                          setReplacement(flag.fix!.replacement);
                          setMode("idle");
                        }}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <Button size="sm" color="secondary" onClick={() => setMode("edit")}>
                        Edit
                      </Button>
                    )}
                    <Button
                      size="sm"
                      color="primary"
                      iconLeading={Check}
                      isDisabled={!replacement.trim()}
                      onClick={() => void run(source.applyFix(flag.id, replacement.trim()))}
                    >
                      Apply
                    </Button>
                  </>
                }
              />
              <CardBody>
                {mode === "edit" ? (
                  <TextArea label="Your version of the sentence" value={replacement} onChange={setReplacement} autoFocus />
                ) : (
                  <p className="text-md leading-7 text-secondary">
                    {flag.says.before}
                    <del className="text-error-primary decoration-1">{flag.says.quote}</del>{" "}
                    <ins className="text-success-primary no-underline">{replacement}</ins>
                    {flag.says.after}
                  </p>
                )}
              </CardBody>
            </Card>
          )
        )}

        {mode === "contest" && (
          <CardSection label="Why both can be true">
            <p className="mb-3 text-sm text-tertiary">
              One or two sentences: a date, a scope, a customer segment. The Guardian decides. A thin case is admitted as contested, which
              closes the flag and lowers the knowledge base grade.
            </p>
            <TextArea
              label="Your argument"
              value={argument}
              onChange={setArgument}
              autoFocus
              placeholder="The post was written before the rename on 1 September, and…"
            />
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
          </CardSection>
        )}

        {settled && (
          <CardSection label="Or close it">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <CloseOption title="It isn't inconsistent" body="Argue why both can be true. The Guardian decides." onPress={() => setMode("contest")} />
              {flag.cantFix && flag.object.kind === "newsletter" ? (
                <CloseOption title="Noted" body="Closes the task." onPress={() => void run(source.closeFlag(flag.id, "noted"))} />
              ) : flag.cantFix ? (
                <CloseOption
                  title="We took it down"
                  body="The post is deleted, so it leaves the grade."
                  onPress={() => void run(source.closeFlag(flag.id, "retracted"))}
                />
              ) : (
                <CloseOption
                  title="True, but not worth fixing"
                  body="Closes the task. Still counts against your content grade."
                  onPress={() => void run(source.closeFlag(flag.id, "wont_fix"))}
                />
              )}
            </div>
          </CardSection>
        )}

        <CardSection label="Metadata">
          <MetaList
            items={[
              { label: "Urgency", value: flag.urgency === "high" ? "High" : "Normal" },
              { label: kind, value: flag.object.state },
              { label: "Confidence", value: `${Math.round(flag.confidence * 100)}%` },
            ]}
          />
        </CardSection>
      </CardBody>
      <CardFooter>Raised by the Checker on {flag.raised}.</CardFooter>
    </Card>
  );
}

function CloseOption({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-lg border border-secondary bg-primary px-4 py-3 text-left outline-focus-ring transition-colors hover:bg-primary_hover focus-visible:outline-2"
    >
      <span className="block text-sm font-semibold text-primary">{title}</span>
      <span className="mt-0.5 block text-sm text-tertiary">{body}</span>
    </button>
  );
}
