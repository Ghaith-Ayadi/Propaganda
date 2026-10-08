// A knowledge base item that needs its owner: two claims at odds, or a change
// the Guardian can't make alone (retiring a remembered or owned claim). The
// person rules; posts relying on the losing claim get a re-check.

import { Button } from "@/components/base/buttons/button";
import { reportError } from "@/lib/telemetry";
import { ClaimBlock } from "./bits";
import type { InboxSource, KnowledgeItem } from "./data";

export function KnowledgeDetail({ item, source }: { item: KnowledgeItem; source: InboxSource }) {
  const rule = (choice: 0 | 1) => source.rule(item.id, choice).catch((err) => reportError("Inbox.knowledge", err));
  const conflict = item.kind === "conflict";

  return (
    <article className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-secondary">{conflict ? "Two claims disagree" : "A change needs its owner"}</p>
        <h2 className="mt-2 font-title text-2xl leading-tight text-primary">{item.title}</h2>
        <p className="mt-1 text-md text-tertiary">{item.why}</p>
      </header>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ClaimBlock claim={item.a} heading={conflict ? "One claim" : "Current claim"} />
        <ClaimBlock claim={item.b} heading={conflict ? "The other" : "Proposed"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" color="secondary" onClick={() => void rule(0)}>
          {item.choices[0]}
        </Button>
        <Button size="sm" color="primary" onClick={() => void rule(1)}>
          {item.choices[1]}
        </Button>
      </div>
    </article>
  );
}
