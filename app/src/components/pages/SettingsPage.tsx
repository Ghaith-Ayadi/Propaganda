// #/settings until the Settings thread lands: the 0.1 settings dialog,
// opened from here.

import { useState } from "react";
import { Settings01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Page } from "@/components/shell/PageHeader";

export function SettingsPage() {
  const [open, setOpen] = useState(true);
  return (
    <Page title="Settings" description="People, content, agents and this tenant's details.">
      <Button color="secondary" iconLeading={Settings01} onClick={() => setOpen(true)}>
        Open settings
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </Page>
  );
}
