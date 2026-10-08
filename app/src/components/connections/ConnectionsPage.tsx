// Connections (0.2): where Propaganda gets its material and where it can go.
// Tabs: Sources, AI (through MCP), Outside CMSs.

import { Tabs } from "react-aria-components";
import { goPage, usePageRest } from "@/lib/route";
import { Tab, TabList, TabPanel } from "@/components/application/tabs/tabs";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { AiTab } from "./AiTab";
import { OutsideTab } from "./OutsideTab";
import { SourcesTab } from "./SourcesTab";

const TABS = ["sources", "ai", "outside"];

export function ConnectionsPage() {
  const rest = usePageRest();
  const selected = TABS.includes(rest ?? "") ? rest! : "sources";
  return (
    <PageBody>
      <PageHeader title="Connections" description="What Propaganda reads, how your AI tools reach it, and the sites it can publish to." />
      <Tabs selectedKey={selected} onSelectionChange={(k) => goPage("connections", String(k))}>
        <TabList type="underline" size="md" aria-label="Connections">
          <Tab id="sources">Sources</Tab>
          <Tab id="ai">AI</Tab>
          <Tab id="outside">Outside CMSs</Tab>
        </TabList>
        <TabPanel id="sources" className="pt-6"><SourcesTab /></TabPanel>
        <TabPanel id="ai" className="pt-6"><AiTab /></TabPanel>
        <TabPanel id="outside" className="pt-6"><OutsideTab /></TabPanel>
      </Tabs>
    </PageBody>
  );
}
