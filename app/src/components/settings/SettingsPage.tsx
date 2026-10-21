// Settings (0.2): People, Content, Knowledge, Agents, Goals, plus the site and
// editor settings that already worked (reused from SettingsDialog).

import { useEffect } from "react";
import { goPage, replacePage, usePageRest } from "@/lib/route";
import { Edit05 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { EditorTab, TemplatesTab } from "@/components/SettingsDialog";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { Card } from "./ui";
import { AppearanceSection } from "./AppearanceSection";
import { AgentsSection } from "./AgentsSection";
import { ContentSection } from "./ContentSection";
import { KnowledgeSection } from "./KnowledgeSection";
import { PeopleSection } from "./PeopleSection";

const SECTIONS = [
  { id: "people", label: "People and owners" },
  { id: "content", label: "Content" },
  { id: "knowledge", label: "Knowledge" },
  { id: "agents", label: "Agents" },
  { id: "goals", label: "Goals" },
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "templates", label: "Templates" },
] as const;

/** Author, Site and Design moved to the Site page; old links land there. */
const MOVED: Record<string, string> = { author: "author", site: "details", design: "design" };

export function SettingsPage() {
  const rest = usePageRest();
  const moved = rest ? MOVED[rest] : undefined;
  useEffect(() => {
    if (moved) replacePage("site", moved);
  }, [moved]);
  const selected = SECTIONS.some((s) => s.id === rest) ? rest! : "people";
  return (
    <>
      <PageHeader
        title="Settings"
        description="Everyone invited to this tenant can change all of this. Roles come later. Connections have their own page."
        tabs={<PageTabs label="Settings sections" items={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} selected={selected} onChange={(id) => goPage("settings", id)} />}
      />
      <PageBody>
        {selected === "people" && <PeopleSection />}
        {selected === "content" && <ContentSection />}
        {selected === "knowledge" && <KnowledgeSection />}
        {selected === "agents" && <AgentsSection />}
        {selected === "goals" && <GoalsLink />}
        {selected === "appearance" && <AppearanceSection />}
        {selected === "editor" && <Plain title="Editor"><EditorTab /></Plain>}
        {selected === "templates" && <Plain title="Templates"><TemplatesTab /></Plain>}
      </PageBody>
    </>
  );
}

function Plain({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card title={title}>{children}</Card>;
}

/** Goals has its own page (another thread builds it); Settings only points there. */
function GoalsLink() {
  return (
    <Card
      title="Goals"
      description="Four goals per calendar quarter: Volume, Consistency, Readership and Ranking. We propose them, you tweak and approve."
      action={
        <Button size="sm" href="#/goals" iconLeading={Edit05}>
          Open Goals
        </Button>
      }
    />
  );
}
