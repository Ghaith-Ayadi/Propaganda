import { useState } from "react";
import { Trash01, Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { useTranscriptUrl, useWatchedSites } from "@/lib/tenantConfig";
import { Card, CopyField, Note } from "@/components/settings/ui";
import { ConnectCard } from "./ConnectCard";

export function SourcesTab() {
  return (
    <div className="space-y-6">
      <ConnectCard
        id="granola"
        title="Granola"
        description="Meeting notes and transcripts flow in after every call. The Listener reads them for ideas and candidate facts."
      />
      <TranscriptUrlCard />
      <ConnectCard
        id="slack"
        title="Slack"
        description="Where ideas live and facts come from. The Listener reads the channels you pick."
        detailLabel="Workspace"
        detailPlaceholder="ledgerline.slack.com"
      />
      <WatchedSitesCard />
      <ConnectCard
        id="newsletter"
        title="Newsletter"
        description="Read your existing newsletter archive so past issues count toward Volume and the Checker can compare against them."
        detailLabel="Archive or feed URL"
        detailPlaceholder="https://example.com/newsletter/rss"
      />
    </div>
  );
}

function TranscriptUrlCard() {
  const { url, create, regenerate } = useTranscriptUrl();
  const curl = `curl -X POST "${url || "<your URL>"}" \\\n  -H "Content-Type: text/plain" \\\n  --data-binary @transcript.txt`;
  return (
    <Card
      title="Open transcript URL"
      description="Anyone can POST a transcript to this address: a recorder, a Zap, a script. No integration needed."
    >
      <div className="space-y-3">
        {url ? (
          <>
            <CopyField label="Transcript URL" value={url} />
            <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-xs text-secondary">{curl}</pre>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                color="secondary-destructive"
                onClick={() => {
                  regenerate();
                  toast.add({ type: "success", title: "New URL created", description: "The old one stops working." });
                }}
              >
                Make a new URL
              </Button>
              <span className="text-xs text-tertiary">Anyone holding the URL can send transcripts, so treat it like a password.</span>
            </div>
          </>
        ) : (
          <Button size="sm" onClick={create}>Create the URL</Button>
        )}
        <Note>The address is shaped like the real one; the endpoint that accepts transcripts ships with the transcript worker.</Note>
      </div>
    </Card>
  );
}

function WatchedSitesCard() {
  const { sites, add, remove } = useWatchedSites();
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  return (
    <Card
      title="Websites we watch"
      description="Specific pages the Scout follows for ideas, each tied to a topic: a regulator's news page, a competitor's blog."
    >
      {sites.length > 0 && (
        <ul className="mb-3 divide-y divide-secondary rounded-lg border border-secondary">
          {sites.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-primary">{s.url}</span>
              <span className="text-tertiary">{s.topic || "No topic"}</span>
              <Button size="sm" color="tertiary" aria-label={`Stop watching ${s.url}`} iconLeading={Trash01} onClick={() => remove(s.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Input size="sm" label="Address" placeholder="https://www.fda.gov/news" value={url} onChange={setUrl} wrapperClassName="flex-1" />
        <Input size="sm" label="Topic" placeholder="School nutrition" value={topic} onChange={setTopic} wrapperClassName="w-48" />
        <Button
          size="sm"
          color="secondary"
          iconLeading={Plus}
          isDisabled={!/^https?:\/\/.+\..+/.test(url.trim())}
          onClick={() => {
            add(url, topic);
            setUrl("");
            setTopic("");
          }}
        >
          Watch
        </Button>
      </div>
    </Card>
  );
}
