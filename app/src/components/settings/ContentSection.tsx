import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Trash01, Plus } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { db } from "@/lib/db";
import { PLATFORMS, type Platform, useEmailThreads, useSocialChannels } from "@/lib/tenantConfig";
import { Card, Note } from "./ui";

export function ContentSection() {
  return (
    <div className="space-y-6">
      <BlogCard />
      <SocialCard />
      <EmailCard />
      <Card
        title="Sales enablement"
        description="Decks, one-pagers and answers for the sales team."
        action={<Badge size="sm" color="gray">After 0.2</Badge>}
      />
    </div>
  );
}

function BlogCard() {
  const collections = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], []);
  return (
    <Card title="Blog" description="Posts live in collections. Each collection is a topic readers can follow.">
      {collections.length === 0 ? (
        <Note>No collections yet. Add one from the collection tabs on the Content page.</Note>
      ) : (
        <ul className="divide-y divide-secondary rounded-lg border border-secondary">
          {collections.map((c) => (
            <li key={c.name} className="flex items-center gap-2 px-4 py-2.5 text-sm text-primary">
              <span>{c.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.isHidden && <Badge size="sm" color="gray">Hidden</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SocialCard() {
  const { channels, add, remove } = useSocialChannels();
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [page, setPage] = useState("");
  const name = (id: Platform) => PLATFORMS.find((p) => p.id === id)?.name ?? id;

  return (
    <Card title="Social" description="A channel is a platform plus a specific page or account. Two LinkedIn pages is two channels.">
      {channels.length > 0 && (
        <ul className="mb-3 divide-y divide-secondary rounded-lg border border-secondary">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="font-medium text-primary">{name(c.platform)}</span>
              <span className="min-w-0 flex-1 truncate text-tertiary">{c.page}</span>
              <Button size="sm" color="tertiary" aria-label={`Remove ${c.page}`} iconLeading={Trash01} onClick={() => remove(c.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Select
          size="sm"
          label="Platform"
          aria-label="Platform"
          selectedKey={platform}
          onSelectionChange={(k) => setPlatform(k as Platform)}
          items={PLATFORMS.map((p) => ({ id: p.id, label: p.name }))}
          className="w-40"
        >
          {(item) => <Select.Item id={item.id} label={item.label} />}
        </Select>
        <Input size="sm" label="Page or account" placeholder="@ledgerline or /company/ledgerline" value={page} onChange={setPage} wrapperClassName="flex-1" />
        <Button
          size="sm"
          color="secondary"
          iconLeading={Plus}
          isDisabled={!page.trim()}
          onClick={() => {
            add(platform, page);
            setPage("");
          }}
        >
          Add channel
        </Button>
      </div>
      <div className="mt-3">
        <Note>Social writing and publishing come after 0.2. Channels are saved now so the Strategist can plan for them.</Note>
      </div>
    </Card>
  );
}

function EmailCard() {
  const { threads, add, remove } = useEmailThreads();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  return (
    <Card title="Email" description="Grouped by thread: a newsletter, a sequence. Once sent, an email can't be fixed.">
      {threads.length > 0 && (
        <ul className="mb-3 divide-y divide-secondary rounded-lg border border-secondary">
          {threads.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="font-medium text-primary">{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-tertiary">{t.about}</span>
              <Button size="sm" color="tertiary" aria-label={`Remove ${t.name}`} iconLeading={Trash01} onClick={() => remove(t.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Input size="sm" label="Thread" placeholder="The Close" value={name} onChange={setName} wrapperClassName="w-48" />
        <Input size="sm" label="What it is" placeholder="Monthly newsletter for controllers" value={about} onChange={setAbout} wrapperClassName="flex-1" />
        <Button
          size="sm"
          color="secondary"
          iconLeading={Plus}
          isDisabled={!name.trim()}
          onClick={() => {
            add(name, about);
            setName("");
            setAbout("");
          }}
        >
          Add thread
        </Button>
      </div>
    </Card>
  );
}
