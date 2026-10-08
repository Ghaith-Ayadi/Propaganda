import { Lock01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { pageHref } from "@/lib/route";
import type { PageRoute } from "@/lib/routes";

/** A full-plan page opened on Lite (an old link, a typed address). */
export function LockedPage({ page }: { page: PageRoute }) {
  return (
    <PageBody>
      <PageHeader title={page.label} description={page.description} />
      <div className="flex flex-col items-center rounded-xl border border-dashed border-secondary px-6 py-16 text-center">
        <Lock01 className="size-6 text-quaternary" />
        <p className="mt-3 text-sm font-medium text-secondary">Part of the full Propaganda</p>
        <p className="mt-1 max-w-sm text-sm text-tertiary">
          Lite is the editor and your blog. The agents, the knowledge base and the goals come with an upgrade.
        </p>
        <Button className="mt-5" color="secondary" href={pageHref("upgrade")}>
          See what's included
        </Button>
      </div>
    </PageBody>
  );
}
