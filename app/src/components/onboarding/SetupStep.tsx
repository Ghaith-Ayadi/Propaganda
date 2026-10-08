// Onboarding step 1: the business itself. Website first, because later the
// rest of onboarding gets pre-filled from it (not built yet); then its name,
// then how much the team can review, which sets the Strategist's pace.
//
//   tenant.website             the business's site (public anyway)
//   strategist.reviewPerMonth  posts a month the team can review
//
// The name is the site's own (lib/accounts.ts updateSite), owners only.

import { useEffect, useState } from "react";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { useWorkspace } from "@/components/Workspace";
import { updateSite } from "@/lib/accounts";
import { userMessage } from "@/lib/errors";
import { setSetting, useSetting } from "@/lib/settings";
import { reportError } from "@/lib/telemetry";

export const REVIEW_OPTIONS = [
  { value: "4", label: "4, about one a week" },
  { value: "8", label: "8, about two a week" },
  { value: "12", label: "12, about three a week" },
  { value: "16", label: "16 or more" },
];

export function SetupStep() {
  const { account, site, refreshSite } = useWorkspace();
  const website = useSetting<string>("tenant.website", "") ?? "";
  const review = useSetting<string>("strategist.reviewPerMonth", "8") ?? "8";
  const [name, setName] = useState(site.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const isOwner = site.role === "owner";

  useEffect(() => setName(site.name), [site.name]);

  async function saveName() {
    const next = name.trim();
    if (!isOwner || !next || next === site.name) return;
    setNameError(null);
    try {
      refreshSite(await updateSite(account, site.id, { name: next }));
    } catch (err) {
      reportError("Business name not saved", err);
      setNameError(userMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Input
        label="Your business's website"
        type="url"
        placeholder="https://kontra.run"
        defaultValue={website}
        hint="The site your customers know you by."
        onBlur={(e) => void setSetting("tenant.website", (e.target as HTMLInputElement).value.trim())}
      />
      <Input
        label="Your business's name"
        value={name}
        onChange={setName}
        isDisabled={!isOwner}
        isInvalid={!!nameError}
        hint={nameError ?? (isOwner ? undefined : "Only the owner can change it.")}
        onBlur={() => void saveName()}
      />
      <NativeSelect
        label="How many posts a month can your team review?"
        hint="We do the writing. The Strategist plans to this number, and you can change it any time."
        value={review}
        onChange={(e) => void setSetting("strategist.reviewPerMonth", e.target.value)}
        options={REVIEW_OPTIONS}
      />
    </div>
  );
}
