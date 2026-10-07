import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "@untitledui/icons";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { toast } from "@/components/base/toast/toast";
import { useWorkspace } from "@/components/Workspace";
import { db } from "@/lib/db";
import { useTopAuthority, useTopicOwners, usePeople } from "@/lib/tenantConfig";
import { Card, Note } from "./ui";

export function PeopleSection() {
  const { account } = useWorkspace();
  const { people, invite, removeInvite } = usePeople(account);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  function send() {
    if (!email.includes("@")) return;
    invite(email);
    toast.add({ type: "success", title: "Invite saved", description: "Emails go out once invites are wired to the server." });
    setEmail("");
    setInviting(false);
  }

  return (
    <div className="space-y-6">
      <Card
        title="People"
        description="One type of user: everyone allowed in can do and see everything."
        action={
          <Button size="sm" iconLeading={Plus} onClick={() => setInviting(true)}>
            Invite
          </Button>
        }
      >
        <ul className="divide-y divide-secondary rounded-lg border border-secondary">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar size="md" src={p.avatar || undefined} initials={p.name.slice(0, 2).toUpperCase()} alt={p.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-primary">{p.name}</div>
                {p.name !== p.email && <div className="truncate text-xs text-tertiary">{p.email}</div>}
              </div>
              {p.status === "invited" ? (
                <>
                  <Badge color="warning" size="sm">Invited</Badge>
                  <Button size="sm" color="tertiary" onClick={() => removeInvite(p.email)}>
                    Remove
                  </Button>
                </>
              ) : (
                <Badge color="gray" size="sm">You</Badge>
              )}
            </li>
          ))}
        </ul>
        {inviting && (
          <div className="mt-3 flex items-end gap-2">
            <Input
              size="sm"
              label="Email"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={setEmail}
              onKeyDown={(e) => e.key === "Enter" && send()}
              wrapperClassName="flex-1"
            />
            <Button size="sm" onClick={send} isDisabled={!email.includes("@")}>
              Send invite
            </Button>
            <Button size="sm" color="tertiary" onClick={() => setInviting(false)}>
              Cancel
            </Button>
          </div>
        )}
        <div className="mt-3">
          <Note>The member list and invite emails need the server side; today it shows you and the invites you save. Sign-in is Google or an emailed code.</Note>
        </div>
      </Card>
      <OwnersCard people={people.filter((p) => p.status === "active")} />
    </div>
  );
}

function OwnersCard({ people }: { people: { id: string; name: string }[] }) {
  // Topics are the blog's collections until the Strategist owns a topic list.
  const topics = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], []);
  const [owners, setOwners] = useTopicOwners();
  const [authority, setAuthority] = useTopAuthority();
  const items = people.map((p) => ({ id: p.id, label: p.name }));

  return (
    <Card
      title="Topic owners"
      description="When the Guardian sends a change of position up, the owner of the topic decides. Their word is final, short of the top authority."
    >
      <div className="space-y-4">
        <Select
          size="sm"
          label="Top authority"
          hint="The one person who can overrule a topic owner."
          placeholder="Choose a person"
          items={items}
          selectedKey={authority || null}
          onSelectionChange={(k) => setAuthority(String(k))}
        >
          {(item) => <Select.Item id={item.id} label={item.label} />}
        </Select>
        {topics.length === 0 ? (
          <Note>Topics appear here once the blog has collections.</Note>
        ) : (
          topics.map((t) => (
            <Select
              key={t.name}
              size="sm"
              label={t.name}
              placeholder="No owner yet"
              items={items}
              selectedKey={owners[t.name] ?? null}
              onSelectionChange={(k) => setOwners({ ...owners, [t.name]: String(k) })}
            >
              {(item) => <Select.Item id={item.id} label={item.label} />}
            </Select>
          ))
        )}
      </div>
    </Card>
  );
}
