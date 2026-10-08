// #/knowledge: the knowledge base. One page, four views by sub-path:
//   #/knowledge                  claims (the browser)
//   #/knowledge/claims/<id>      one claim, beside the list
//   #/knowledge/flags[/<id>]     flags: content or claims that disagree with it
//   #/knowledge/rechecks[/<id>]  one thread per changed claim, with bulk actions
//   #/knowledge/grades           the two letter grades
// Data comes through lib/knowledge (sample data until the schema is applied).

import { useState } from "react";
import { Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { goPage, usePageRest } from "@/lib/route";
import { kb } from "@/lib/knowledge/adapter";
import { useKb } from "@/lib/knowledge/hooks";
import { SampleNotice } from "./bits";
import { ClaimsView } from "./ClaimsView";
import { FlagsView } from "./FlagsView";
import { RechecksView } from "./RechecksView";
import { GradesView } from "./GradesView";
import { RememberDialog } from "./RememberDialog";

type Tab = "claims" | "flags" | "rechecks" | "grades";

function parseRest(rest: string | null): { tab: Tab; id: string | null } {
  const [head, id] = (rest ?? "").split("/");
  if (head === "flags" || head === "rechecks" || head === "grades") return { tab: head, id: id ?? null };
  return { tab: "claims", id: head === "claims" ? id ?? null : null };
}

export function KnowledgePage() {
  const { tab, id } = parseRest(usePageRest());
  const [remembering, setRemembering] = useState(false);
  const openFlags = useKb("kb.badge", () => kb().flags({ status: "open", kind: "all", offset: 0, limit: 1 }), []);
  const threads = useKb("kb.rechecks", () => kb().rechecks(), []);
  const openRechecks = (threads.data ?? []).reduce((n, t) => n + t.open, 0);
  const flagCount = openFlags.data?.total ?? 0;
  const urgent = (openFlags.data?.urgent ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="What your tenant actually believes, claim by claim. The Guardian is the only thing that writes to it."
        actions={
          <Button size="md" color="primary" iconLeading={Plus} onClick={() => setRemembering(true)}>
            Remember
          </Button>
        }
        tabs={
          <PageTabs
            label="Knowledge base"
            selected={tab}
            onChange={(k) => goPage("knowledge", k === "claims" ? null : k)}
            items={[
              { id: "claims", label: "Claims" },
              // An urgent flag is the only thing that turns the count red.
              urgent
                ? { id: "flags", label: <span className="flex items-center gap-1.5">Flags<Badge size="sm" type="pill-color" color="error">{flagCount}</Badge></span> }
                : { id: "flags", label: "Flags", badge: flagCount || undefined },
              { id: "rechecks", label: "Re-checks", badge: openRechecks || undefined },
              { id: "grades", label: "Grades" },
            ]}
          />
        }
      />
      <PageBody>
        {kb().sample && <SampleNotice />}

        {tab === "claims" && <ClaimsView selected={id} />}
        {tab === "flags" && <FlagsView selected={id} />}
        {tab === "rechecks" && <RechecksView selected={id} />}
        {tab === "grades" && <GradesView />}
      </PageBody>

      {remembering && <RememberDialog onClose={() => setRemembering(false)} />}
    </>
  );
}
