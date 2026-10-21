// Settings (0.2): People, Agents, Appearance and the editor's text styles.
// Only what does something: a setting nothing reads is not shown (Ayadi,
// 2026-10-10 and 2026-10-21). The site, author and design live on the Site page.

import { useEffect } from "react";
import { goPage, replacePage, usePageRest } from "@/lib/route";
import { EditorTab } from "@/components/SettingsDialog";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { Card } from "./ui";
import { AppearanceSection } from "./AppearanceSection";
import { AgentsSection } from "./AgentsSection";
import { PeopleSection } from "./PeopleSection";

const SECTIONS = [
  { id: "people", label: "People and owners" },
  { id: "agents", label: "Agents" },
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
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
        description="People, how we write, and how the app looks. The site, its domain and its design are on the Site page; connections have their own page."
        tabs={<PageTabs label="Settings sections" items={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} selected={selected} onChange={(id) => goPage("settings", id)} />}
      />
      <PageBody>
        {selected === "people" && <PeopleSection />}
        {selected === "agents" && <AgentsSection />}
        {selected === "appearance" && <AppearanceSection />}
        {selected === "editor" && <Plain title="Editor"><EditorTab /></Plain>}
      </PageBody>
    </>
  );
}

function Plain({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card title={title}>{children}</Card>;
}
