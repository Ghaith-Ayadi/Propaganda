import type { PageRoute } from "@/lib/routes";
import { Page } from "./PageHeader";

/** What a registered page shows until a thread builds it. */
export function EmptyPage({ page }: { page: PageRoute }) {
  const Icon = page.icon;
  return (
    <Page title={page.label} description={page.description}>
      <div className="flex flex-col items-center rounded-xl border border-dashed border-secondary px-6 py-16 text-center">
        <Icon className="size-6 text-quaternary" />
        <p className="mt-3 text-sm font-medium text-secondary">Not built yet</p>
        <p className="mt-1 text-sm text-tertiary">This page is coming in Propaganda 0.2.</p>
      </div>
    </Page>
  );
}
