// A knowledge base item that needs its owner: two claims at odds, or a change
// the Guardian can't make alone (retiring a remembered or owned claim). The
// person rules; posts relying on the losing claim get a re-check.

import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardFooter, CardHeader, CardSection } from "@/components/shared/Card";
import { reportError } from "@/lib/telemetry";
import { ClaimText } from "./bits";
import type { InboxSource, KnowledgeItem } from "./data";

export function KnowledgeDetail({ item, source }: { item: KnowledgeItem; source: InboxSource }) {
  const rule = (choice: 0 | 1) => source.rule(item.id, choice).catch((err) => reportError("Inbox.knowledge", err));
  const conflict = item.kind === "conflict";

  return (
    <Card>
      <CardHeader
        title={item.title}
        description={conflict ? "Two claims disagree" : "A change needs its owner"}
        actions={
          <>
            <Button size="sm" color="secondary" onClick={() => void rule(0)}>
              {item.choices[0]}
            </Button>
            <Button size="sm" color="primary" onClick={() => void rule(1)}>
              {item.choices[1]}
            </Button>
          </>
        }
      />
      <CardBody>
        <CardSection label={conflict ? "One claim" : "Current claim"}>
          <ClaimText claim={item.a} />
        </CardSection>
        <CardSection label={conflict ? "The other" : "Proposed"}>
          <ClaimText claim={item.b} />
        </CardSection>
      </CardBody>
      <CardFooter>{item.why}</CardFooter>
    </Card>
  );
}
