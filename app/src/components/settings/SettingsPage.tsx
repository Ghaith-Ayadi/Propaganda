// Settings (0.2): People, Content, Knowledge, Agents, Goals, plus the site and
// editor settings that already worked (reused from SettingsDialog).

import { Tab, TabList, TabPanel } from "@/components/application/tabs/tabs";
import { Tabs } from "react-aria-components";
import { goPage, usePageRest } from "@/lib/route";
import { File02, Globe01, PenTool01, Target04, User01, Users01, Cube01, Zap, BookOpen01, Edit05 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { AuthorTab, EditorTab, SiteTab, TemplatesTab } from "@/components/SettingsDialog";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Card } from "./ui";
import { AgentsSection } from "./AgentsSection";
import { ContentSection } from "./ContentSection";
import { KnowledgeSection } from "./KnowledgeSection";
import { PeopleSection } from "./PeopleSection";

const SECTIONS = [
  { id: "people", label: "People and owners", icon: Users01 },
  { id: "content", label: "Content", icon: BookOpen01 },
  { id: "knowledge", label: "Knowledge", icon: Cube01 },
  { id: "agents", label: "Agents", icon: Zap },
  { id: "goals", label: "Goals", icon: Target04 },
  { id: "author", label: "Author", icon: User01 },
  { id: "site", label: "Site", icon: Globe01 },
  { id: "editor", label: "Editor", icon: PenTool01 },
  { id: "templates", label: "Templates", icon: File02 },
] as const;

export function SettingsPage() {
  const rest = usePageRest();
  const selected = SECTIONS.some((s) => s.id === rest) ? rest! : "people";
  return (
    <PageBody>
      <PageHeader
        title="Settings"
        description="Everyone invited to this tenant can change all of this. Roles come later. Connections have their own page."
      />
      <Tabs orientation="vertical" selectedKey={selected} onSelectionChange={(k) => goPage("settings", String(k))} className="flex flex-col gap-6 md:flex-row">
        <TabList type="button-gray" orientation="vertical" aria-label="Settings sections" className="md:w-56 md:shrink-0">
          {SECTIONS.map((s) => (
            <Tab key={s.id} id={s.id} icon={s.icon}>
              {s.label}
            </Tab>
          ))}
        </TabList>
        <div className="min-w-0 flex-1">
          <TabPanel id="people"><PeopleSection /></TabPanel>
          <TabPanel id="content"><ContentSection /></TabPanel>
          <TabPanel id="knowledge"><KnowledgeSection /></TabPanel>
          <TabPanel id="agents"><AgentsSection /></TabPanel>
          <TabPanel id="goals"><GoalsLink /></TabPanel>
          <TabPanel id="author"><Plain title="Author"><AuthorTab /></Plain></TabPanel>
          <TabPanel id="site"><Plain title="Site"><SiteTab /></Plain></TabPanel>
          <TabPanel id="editor"><Plain title="Editor"><EditorTab /></Plain></TabPanel>
          <TabPanel id="templates"><Plain title="Templates"><TemplatesTab /></Plain></TabPanel>
        </div>
      </Tabs>
    </PageBody>
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
