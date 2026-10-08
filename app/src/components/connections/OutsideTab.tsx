import { type ConnectionId } from "@/lib/tenantConfig";
import { Note } from "@/components/settings/ui";
import { ConnectCard } from "./ConnectCard";

const CMSS: { id: ConnectionId; title: string; what: string }[] = [
  { id: "framer", title: "Framer", what: "Read your pages and publish approved posts to your Framer site." },
  { id: "webflow", title: "Webflow", what: "Read your CMS collections and publish approved posts into one." },
  { id: "wordpress", title: "WordPress", what: "Read posts and publish approved ones through the REST API." },
  { id: "ghost", title: "Ghost", what: "Read posts and publish approved ones through the Admin API." },
  { id: "squarespace", title: "Squarespace", what: "Read-only: public pages and RSS for audits and analytics. Squarespace has no way to publish into it." },
];

export function OutsideTab() {
  return (
    <div className="space-y-6">
      <Note>Your blog can live somewhere else and still use everything else here. Propaganda hosts it too, if you want; that is the Site page.</Note>
      {CMSS.map((c) => (
        <ConnectCard key={c.id} id={c.id} title={c.title} description={c.what} />
      ))}
    </div>
  );
}
