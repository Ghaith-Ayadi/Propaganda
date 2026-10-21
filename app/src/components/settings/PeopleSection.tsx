import { useState } from "react";
import { Plus } from "@untitledui/icons";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { toast } from "@/components/base/toast/toast";
import { useWorkspace } from "@/components/Workspace";
import { userMessage } from "@/lib/errors";
import { usePeople, type PersonRole } from "@/lib/people";
import { reportError } from "@/lib/telemetry";
import { Card, Note } from "./ui";

const ROLES: { id: PersonRole; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "owner", label: "Owner" },
];

export function PeopleSection() {
  const { account } = useWorkspace();
  const { members, invites, error, invite, revokeInvite, setRole, remove } = usePeople();
  const [email, setEmail] = useState("");
  const [role, setInviteRole] = useState<PersonRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const meId = account.authId || account.userId;
  const iAmOwner = members?.find((m) => m.userId === meId)?.role === "owner";

  /** Run a change, say how it went, and report what failed. */
  async function run(what: string, fn: () => Promise<unknown>, done?: { title: string; description?: string }) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.add({ type: "success", ...done });
    } catch (err) {
      reportError(`settings.people.${what}`, err);
      toast.add({ type: "error", title: "That didn't work", description: userMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const address = email.trim().toLowerCase();
    if (!address.includes("@")) return;
    await run("invite", () => invite(address, role), {
      title: "Invite saved",
      description: `${address} joins when they sign in with that email at app.propaganda.pub. We don't email them yet: let them know.`,
    });
    setEmail("");
    setInviting(false);
  }

  return (
    <Card
      title="People"
      description="Owners invite people, change roles and manage the site. Editors write. Both see everything on the site."
      action={
        iAmOwner ? (
          <Button size="sm" iconLeading={Plus} onClick={() => setInviting(true)}>
            Invite
          </Button>
        ) : undefined
      }
    >
      {error != null && <Note>{userMessage(error)}</Note>}
      <ul className="divide-y divide-secondary rounded-lg border border-secondary">
        {(members ?? []).map((m) => {
          const label = m.name || m.email || "Member";
          const isMe = m.userId === meId;
          return (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar size="md" src={m.avatar || undefined} initials={label.slice(0, 2).toUpperCase()} alt={label} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-primary">
                  {label}
                  {isMe && <span className="ml-2 text-xs font-normal text-tertiary">You</span>}
                </div>
                {m.email && m.email !== label && <div className="truncate text-xs text-tertiary">{m.email}</div>}
              </div>
              {iAmOwner ? (
                <Select
                  size="sm"
                  aria-label={`Role of ${label}`}
                  items={ROLES}
                  selectedKey={m.role}
                  isDisabled={busy}
                  onSelectionChange={(k) => {
                    const next = String(k) as PersonRole;
                    if (next !== m.role) void run("role", () => setRole(m.userId, next), { title: "Role changed" });
                  }}
                  popoverClassName="w-32"
                  className="w-32"
                >
                  {(item) => <Select.Item id={item.id} label={item.label} />}
                </Select>
              ) : (
                <Badge color="gray" size="sm">{m.role === "owner" ? "Owner" : "Editor"}</Badge>
              )}
              {iAmOwner && !isMe &&
                (removing === m.userId ? (
                  <Button
                    size="sm"
                    color="primary-destructive"
                    isDisabled={busy}
                    onClick={() => {
                      setRemoving(null);
                      void run("remove", () => remove(m.userId), { title: "Removed" });
                    }}
                  >
                    Confirm
                  </Button>
                ) : (
                  <Button size="sm" color="tertiary" isDisabled={busy} onClick={() => setRemoving(m.userId)}>
                    Remove
                  </Button>
                ))}
            </li>
          );
        })}
        {iAmOwner &&
          invites.map((i) => (
            <li key={i.email} className="flex items-center gap-3 px-4 py-3">
              <Avatar size="md" initials={i.email.slice(0, 2).toUpperCase()} alt={i.email} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-primary">{i.email}</div>
              </div>
              <Badge color="warning" size="sm">Invited as {i.role}</Badge>
              <Button size="sm" color="tertiary" isDisabled={busy} onClick={() => void run("revoke", () => revokeInvite(i.email))}>
                Withdraw
              </Button>
            </li>
          ))}
      </ul>
      {iAmOwner && inviting && (
        <div className="mt-3 flex items-end gap-2">
          <Input
            size="sm"
            label="Email"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={setEmail}
            onKeyDown={(e) => e.key === "Enter" && void send()}
            wrapperClassName="flex-1"
          />
          <Select
            size="sm"
            label="Role"
            items={ROLES}
            selectedKey={role}
            onSelectionChange={(k) => setInviteRole(String(k) as PersonRole)}
            popoverClassName="w-32"
            className="w-32"
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>
          <Button size="sm" onClick={() => void send()} isDisabled={busy || !email.includes("@")}>
            Save invite
          </Button>
          <Button size="sm" color="tertiary" onClick={() => setInviting(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="mt-3">
        <Note>An invited person joins by signing in with the invited email, through Google or an emailed code. A site always keeps one owner.</Note>
      </div>
    </Card>
  );
}
