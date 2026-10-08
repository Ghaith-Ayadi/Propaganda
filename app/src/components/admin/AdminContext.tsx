import { createContext, useContext } from "react";
import type { Account } from "@/lib/accounts";
import type { Client } from "@/lib/supabase";

export interface AdminApi {
  /** The superadmin account on this browser (not necessarily the open tenant's). */
  account: Account;
  /** Its Supabase client: use this for every Admin request. */
  client: Client;
}

export const AdminContext = createContext<AdminApi | null>(null);

export function useAdmin(): AdminApi {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin outside the Admin page");
  return ctx;
}
