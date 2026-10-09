// Admin > Waitlist: everyone who joined the waitlist on propaganda.pub, newest
// first. Mounted by lib/admin/sections.tsx as the "waitlist" section
// (#/admin/waitlist). Reads public.admin_waitlist(), which starts with
// private.require_superadmin().

import { useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import { must } from "@/lib/supabase";
import { userMessage, withCode } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

interface Entry {
  id: number;
  email: string;
  name: string;
  website: string;
  note: string;
  created: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function WaitlistPage() {
  const { client } = useAdmin();
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    withCode("WAITLIST-LOAD", must(client.rpc("admin_waitlist"))).then(
      (r) => setRows(r as Entry[]),
      (err) => {
        reportError("WaitlistPage", err);
        setError(userMessage(err));
      },
    );
  }, [client]);

  if (error) return <p className="text-sm text-error-primary">{error}</p>;
  if (!rows) return <p className="text-sm text-tertiary">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-tertiary">{rows.length} {rows.length === 1 ? "person" : "people"}</p>
      <div className="overflow-x-auto rounded-xl border border-secondary">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary">
              <th className="px-4 py-2">Joined</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Site</th>
              <th className="px-4 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-tertiary">Nobody yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-secondary align-top">
                <td className="whitespace-nowrap px-4 py-2 text-tertiary">{day(r.created)}</td>
                <td className="px-4 py-2 text-primary"><a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a></td>
                <td className="px-4 py-2 text-secondary">{r.name}</td>
                <td className="px-4 py-2 text-secondary">{r.website}</td>
                <td className="max-w-[360px] whitespace-pre-wrap px-4 py-2 text-secondary">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
