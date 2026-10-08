// Settings (0.2): People, Content, Knowledge, Agents, Goals, plus the site and
// editor settings that already worked (reused from SettingsDialog).

import { goPage, usePageRest } from "@/lib/route";
import { Edit05 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { AuthorTab, DesignSection, EditorTab, SiteTab, TemplatesTab } from "@/components/SettingsDialog";
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
  { id: "author", label: "Author" },
  { id: "site", label: "Site" },
  { id: "design", label: "Design" },
  { id: "editor", label: "Editor" },
  { id: "templates", label: "Templates" },
] as const;

export function SettingsPage() {
  const rest = usePageRest();
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
        {selected === "author" && <Plain title="Author"><AuthorTab /></Plain>}
        {selected === "site" && <Plain title="Site"><SiteTab /></Plain>}
        {selected === "design" && <Plain title="Design"><DesignSection /></Plain>}
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
      description="Five goals per calendar quarter: Volume, Coverage, Consistency, Readership and Ranking. The Strategist proposes them, you tweak and approve."
      action={
        <Button size="sm" href="#/goals" iconLeading={Edit05}>
          Open Goals
        </Button>
      }
    />
  );
}
