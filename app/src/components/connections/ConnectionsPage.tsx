// Connections (0.2): what Propaganda reads, how AI tools reach it, and the
// sites it can publish to. A list of connectors on the left, the picked one's
// body on the right. Sub-path: #/connections/<tab>/<connector>.

import { Card } from "@/components/shell/Card";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { goPage, usePageRest } from "@/lib/route";
import { cx } from "@/utils/cx";
import { CONNECTORS, GROUPS, type Group } from "./connectors";
import { ConnectorBody } from "./ConnectorBody";
import { Logo } from "./logos";

export function ConnectionsPage() {
  const [g, id] = (usePageRest() ?? "").split("/");
  const group: Group = GROUPS.some((x) => x.id === g) ? (g as Group) : "sources";
  const list = CONNECTORS.filter((c) => c.group === group);
  const picked = list.find((c) => c.id === id) ?? list[0];

  return (
    <>
      <PageHeader
        title="Connections"
        description="What Propaganda reads, how your AI tools reach it, and the sites it can publish to."
        tabs={<PageTabs label="Connections" items={GROUPS.map((x) => ({ id: x.id, label: x.label }))} selected={group} onChange={(k) => goPage("connections", k)} />}
      />
      <PageBody>
      <Card>
      <div className="flex flex-col md:flex-row">
        <ul className="shrink-0 divide-y divide-secondary border-b border-secondary md:w-72 md:border-r md:border-b-0" aria-label="Connectors">
          {list.map((c) => {
            const on = c.id === picked.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={on}
                  onClick={() => goPage("connections", `${group}/${c.id}`)}
                  className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition", on ? "bg-secondary" : "hover:bg-primary_hover")}
                >
                  <Logo id={c.logo} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-primary">{c.name}</span>
                    <span className="block truncate text-xs text-tertiary">{c.summary}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="min-w-0 flex-1" key={picked.id}>
          <ConnectorBody connector={picked} />
        </div>
      </div>
      </Card>
      </PageBody>
    </>
  );
}
