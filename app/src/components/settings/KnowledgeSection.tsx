import { ArrowDown, ArrowUp } from "@untitledui/icons";
import { Toggle } from "@/components/base/toggle/toggle";
import { Button } from "@/components/base/buttons/button";
import {
  type GuardianStrictness,
  useGuardianStrictness,
  useRecheckOnChange,
  useSourceTiers,
} from "@/lib/tenantConfig";
import { Card, Note, Segmented } from "./ui";

const STRICTNESS_HINT: Record<GuardianStrictness, string> = {
  relaxed: "Contests a claim only when a higher source clearly disagrees. Fewer flags, more debt can slip in.",
  balanced: "The default. A claim goes in; where it conflicts with a source of equal or higher tier it is contested until someone settles it.",
  strict: "Contests anything a higher or equal source does not back. More flags and a harder knowledge base grade.",
};

export function KnowledgeSection() {
  const [tiers, setOrder] = useSourceTiers();
  const [strictness, setStrictness] = useGuardianStrictness();
  const [recheck, setRecheck] = useRecheckOnChange();

  function move(i: number, by: -1 | 1) {
    const ids = tiers.map((t) => t.id);
    const j = i + by;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
  }

  return (
    <div className="space-y-6">
      <Card title="Which evidence wins" description="When two sources disagree, the higher one holds until a topic owner says otherwise.">
        <ol className="space-y-2">
          {tiers.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-secondary px-4 py-2.5">
              <span className="w-4 text-sm text-quaternary">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-primary">{t.name}</div>
                <div className="text-xs text-tertiary">{t.what}</div>
              </div>
              <Button size="sm" color="tertiary" aria-label={`Move ${t.name} up`} iconLeading={ArrowUp} isDisabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="sm" color="tertiary" aria-label={`Move ${t.name} down`} iconLeading={ArrowDown} isDisabled={i === tiers.length - 1} onClick={() => move(i, 1)} />
            </li>
          ))}
        </ol>
      </Card>

      <Card title="The Guardian" description="The only thing that writes to the knowledge base. It flags; it never turns away a Remember.">
        <div className="space-y-3">
          <div className="text-sm font-medium text-primary">How strict it is</div>
          <Segmented<GuardianStrictness>
            label="Guardian strictness"
            value={strictness}
            onChange={setStrictness}
            options={[
              { value: "relaxed", label: "Relaxed" },
              { value: "balanced", label: "Balanced" },
              { value: "strict", label: "Strict" },
            ]}
          />
          <p className="text-xs text-tertiary">{STRICTNESS_HINT[strictness]}</p>
          <div className="rounded-lg border border-secondary p-4">
            <Toggle
              isSelected={recheck}
              onChange={setRecheck}
              label="Re-check content when a claim changes"
              hint="Every piece that relies on the claim is re-read and gets one summary with bulk actions."
            />
          </div>
          <Note>Contested claims enter the knowledge base and weigh on its grade until someone reconciles them.</Note>
        </div>
      </Card>
    </div>
  );
}
