// Styles: how the tenant wants its writing to sound, one rule a row
// (public.kb_styles). Every draft, pitch, plan and Chat reply follows them
// after our twenty rules. A rule can add to the twenty or relax a judgement
// call (jokes welcome); zero em dashes holds whatever a rule says.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { userMessage } from "@/lib/errors";
import { addStyle, loadStyles, retireStyle, type StyleRule } from "@/lib/kbStyles";
import { reportError, track } from "@/lib/telemetry";
import { Empty, Loading, TextArea, formatDate } from "./bits";

export function StylesView() {
  const [rules, setRules] = useState<StyleRule[] | null>(null);
  const [rule, setRule] = useState("");
  const [example, setExample] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRules(await loadStyles());
    } catch (err) {
      reportError("kb.styles", err);
      toast.add({ type: "error", title: "Couldn't load your style rules", description: userMessage(err) });
      setRules([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const add = async () => {
    if (!rule.trim()) return;
    setBusy("add");
    try {
      await addStyle(rule, example);
      track("kb_style_add", { example: Boolean(example.trim()) });
      setRule("");
      setExample("");
      await load();
    } catch (err) {
      reportError("kb.styles.add", err);
      toast.add({ type: "error", title: "Couldn't add this rule", description: userMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const retire = async (id: string) => {
    setBusy(id);
    try {
      await retireStyle(id);
      track("kb_style_retire");
      await load();
    } catch (err) {
      reportError("kb.styles.retire", err);
      toast.add({ type: "error", title: "Couldn't retire this rule", description: userMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {rules === null ? (
          <Loading />
        ) : rules.length === 0 ? (
          <Empty title="No style rules yet">
            Every draft follows our twenty rules. Add what your own writing should do on top of them.
          </Empty>
        ) : (
          <ul className="divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            {rules.map((r) => (
              <li key={r.id} className="flex items-start gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-line text-primary">{r.rule}</p>
                  {r.example && <p className="mt-1.5 text-sm whitespace-pre-line text-tertiary">Tone: {r.example}</p>}
                  <p className="mt-1.5 text-xs text-quaternary">Added {formatDate(r.created)}</p>
                </div>
                <Button size="sm" color="tertiary" isLoading={busy === r.id} onClick={() => void retire(r.id)}>
                  Retire
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4 self-start rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary">
        <div>
          <p className="text-sm font-medium text-primary">Add a rule</p>
          <p className="mt-1 text-sm text-tertiary">
            One rule about how your writing sounds. We follow it in every draft, pitch and reply, after our twenty rules.
          </p>
        </div>
        <TextArea
          label="The rule"
          value={rule}
          onChange={setRule}
          rows={3}
          placeholder="Never open a post with a quote from a vendor."
        />
        <TextArea
          label="A line in the tone you want (optional)"
          value={example}
          onChange={setExample}
          rows={2}
          hint="We learn the register from it and never reuse the line."
        />
        <Button size="md" color="primary" className="self-end" isDisabled={!rule.trim()} isLoading={busy === "add"} onClick={() => void add()}>
          Add rule
        </Button>
      </div>
    </div>
  );
}
