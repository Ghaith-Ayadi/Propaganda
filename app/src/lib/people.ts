// A site's people: its members (with names and emails) and the invites waiting
// on it. Read and written straight on the server through site_people() and the
// owner functions (20261010000180_site_invites.sql), not synced: it is a
// settings page, and the list has to be the server's.
//
// An invite is an email address and a role. The person joins by signing in
// (Google or an emailed code) with that address; accept_invites() runs after
// every sign-in (lib/accounts.ts) and turns it into a membership.

import { useCallback, useEffect, useState } from "react";
import { coded } from "@/lib/errors";
import { siteId } from "@/lib/scope";
import { sb } from "@/lib/supabase";

export type PersonRole = "owner" | "editor";

export interface Member {
  userId: string;
  role: PersonRole;
  email: string;
  name: string;
  avatar: string;
}

export interface PendingInvite {
  email: string;
  role: PersonRole;
  created: string;
}

interface Raw {
  members: { user_id: string; role: PersonRole; email: string; name: string; avatar: string }[];
  invites: PendingInvite[];
}

async function rpc<T>(fn: string, args: Record<string, unknown>, code: "PEOPLE-LOAD" | "PEOPLE-CHANGE", sentence: string): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    // The functions raise sentences meant to be read ("Only an owner can invite people.").
    const readable = error.code === "22023" || error.code === "42501" ? error.message : sentence;
    throw coded(code, error, readable);
  }
  return data as T;
}

export function usePeople() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const raw = await rpc<Raw>("site_people", { p_site: siteId() }, "PEOPLE-LOAD", "Couldn't load the people on this site.");
      setMembers(raw.members.map((m) => ({ userId: m.user_id, role: m.role, email: m.email, name: m.name, avatar: m.avatar })));
      setInvites(raw.invites);
      setError(null);
    } catch (err) {
      setError(err);
      setMembers((m) => m ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      try {
        await rpc(fn, { p_site: siteId(), ...args }, "PEOPLE-CHANGE", "Couldn't make that change. Try again.");
      } finally {
        await load();
      }
    },
    [load],
  );

  return {
    members,
    invites,
    error,
    invite: (email: string, role: PersonRole) => change("invite_member", { p_email: email, p_role: role }),
    revokeInvite: (email: string) => change("revoke_invite", { p_email: email }),
    setRole: (userId: string, role: PersonRole) => change("set_member_role", { p_user: userId, p_role: role }),
    remove: (userId: string) => change("remove_member", { p_user: userId }),
  };
}
