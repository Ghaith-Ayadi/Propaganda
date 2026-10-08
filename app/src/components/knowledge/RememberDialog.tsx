// Remember: a person states a fact for the knowledge base. It is always let
// in; the Guardian only flags what it contradicts, for the topic's owner.
// Who remembered it is kept as metadata, so the sentence stays bare.

import { useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { coded, userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { kb } from "@/lib/knowledge/adapter";
import { changed, useKb } from "@/lib/knowledge/hooks";
import { TextArea } from "./bits";

/** Gentle hints from the Guardian's wording checks (C1, C2, C6); none of them blocks. */
export function rememberHints(text: string): string[] {
  const t = text.trim();
  const out: string[] = [];
  if (/^\s*([A-Z][a-z]+\s){1,2}(says|said|thinks|told)\b|\baccording to\b/i.test(t))
    out.push("Who said it is saved as metadata, so you can drop the name from the sentence.");
  if (/\b(and also|as well as)\b|;\s/.test(t)) out.push("This may be two facts. Two facts that change separately read better as two claims.");
  if (/\b(currently|now|today|this year|at the moment)\b/i.test(t)) out.push("It can stop being true. Add the date it holds from.");
  return out;
}

export function RememberDialog({ onClose, initialText = "" }: { onClose: () => void; initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [topics, setTopics] = useState<string[]>([]);
  const [asOf, setAsOf] = useState("");
  const [busy, setBusy] = useState(false);
  const allTopics = useKb("kb.topics", () => kb().topics(), []);
  const hints = rememberHints(text);

  const submit = async () => {
    const sentence = text.trim();
    if (!sentence) return;
    setBusy(true);
    try {
      await kb().remember({ text: sentence, topics, scope: asOf.trim() ? { as_of: asOf.trim() } : {} });
      track("kb_remember", { topics: topics.length });
      toast.add({
        type: "success",
        title: "Remembered",
        description: "It's in. The Guardian is checking it against the rest and will flag anything it contradicts.",
      });
      changed();
      onClose();
    } catch (err) {
      const e = coded("KB-REMEMBER", err);
      reportError("kb.remember", e);
      toast.add({ type: "error", title: "Couldn't remember that", description: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => !open && onClose()}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/60 p-4 backdrop-blur-sm sm:items-center"
    >
      <Modal className="w-full max-w-lg rounded-xl bg-primary shadow-2xl ring-1 ring-secondary outline-hidden">
        <Dialog className="flex flex-col gap-5 p-6 outline-hidden">
          <div>
            <Heading slot="title" className="type-heading text-primary">
              Remember
            </Heading>
            <p className="mt-1 text-sm text-tertiary">
              One fact, in one plain sentence. It goes straight in; if it disagrees with something already there, the
              topic's owner gets a flag to settle it.
            </p>
          </div>

          <TextArea
            label="The fact"
            value={text}
            onChange={setText}
            autoFocus
            rows={3}
            placeholder="Onboarding a new clinic takes about a week."
            hint={
              hints.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              ) : undefined
            }
          />

          {(allTopics.data?.length ?? 0) > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium text-secondary">Topics</legend>
              <div className="grid grid-cols-2 gap-2">
                {allTopics.data!.map((t) => (
                  <Checkbox
                    key={t.id}
                    label={t.name}
                    isSelected={topics.includes(t.id)}
                    onChange={(on) => setTopics((cur) => (on ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <Input
            size="sm"
            label="True as of (optional)"
            placeholder="2026-10"
            hint="For facts that can stop being true: a count, a launch, a team."
            value={asOf}
            onChange={setAsOf}
          />

          <div className="flex justify-end gap-2">
            <Button size="md" color="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button size="md" color="primary" isDisabled={!text.trim()} isLoading={busy} onClick={() => void submit()}>
              Remember
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
