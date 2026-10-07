// The 0.2 app's pages. One entry per page: the nav bar, the phone tab strip,
// the command menu and the router all read this list, in this order. A thread
// that builds a page replaces its `component` here and the shell does the
// rest; an entry without one renders a plain empty state from `description`.
//
// A page is a component with no props, at #/<path>[/<rest>]. It reads its
// sub-path with usePageRest() and moves with goPage(id, rest) (lib/route.ts).
// It renders its own header (components/shell/PageHeader.tsx) and fills the
// main column; the shell scrolls it.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  Columns03,
  Dataflow03,
  File06,
  Globe01,
  Home01,
  Inbox01,
  Database01,
  MessageChatCircle,
  Settings01,
  Target04,
} from "@untitledui/icons";
import { useContentTree } from "@/components/pages/contentTree";

export type Icon = ComponentType<{ className?: string }>;

/** A row under a page in the nav (Content's channels and sub-channels). */
export interface NavNode {
  id: string;
  label: string;
  /** #/<path>/<rest>; absent for a placeholder row ("later"). */
  rest?: string;
  icon?: Icon;
  emoji?: string | null;
  count?: number;
  /** Shown instead of a count, greyed out, not clickable: "later". */
  note?: string;
  children?: NavNode[];
}

export interface PageRoute {
  /** Stable key; also the default path. */
  id: string;
  label: string;
  icon: Icon;
  /** Hash segment: the page lives at #/<path>. Lowercase, no slashes. */
  path: string;
  /** Under the page title in the empty state, and the command menu's hint. */
  description: string;
  /** "main" is the nav list; "footer" sits at the bottom of the nav bar. */
  section: "main" | "footer";
  /** The page. Absent: an empty state until a thread builds it. */
  component?: LazyExoticComponent<ComponentType>;
  /** A count beside the label (Inbox). A hook: it may read Dexie or the server. */
  useBadge?: () => number | null;
  /** A tree under the label (Content). A hook, like useBadge. */
  useChildren?: () => NavNode[];
}

export const PAGES: PageRoute[] = [
  {
    id: "home",
    label: "Home",
    icon: Home01,
    path: "home",
    description: "This week, the goals and the two grades at a glance.",
    section: "main",
    // The 0.1 dashboard until the Home thread lands.
    component: lazy(() => import("@/components/HomePage").then((m) => ({ default: m.HomePage }))),
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox01,
    path: "inbox",
    description: "Flags, pitches, knowledge and reviews waiting on you.",
    section: "main",
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: Columns03,
    path: "pipeline",
    description: "Every piece from pitch to published.",
    section: "main",
    // The 0.1 planning board until the Pipeline thread lands.
    component: lazy(() => import("@/components/plan/PlanPage").then((m) => ({ default: m.PlanPage }))),
  },
  {
    id: "content",
    label: "Content",
    icon: File06,
    path: "content",
    description: "Everything you publish, by channel.",
    section: "main",
    component: lazy(() => import("@/components/pages/ContentPage").then((m) => ({ default: m.ContentPage }))),
    useChildren: useContentTree,
  },
  {
    id: "knowledge",
    label: "Knowledge base",
    icon: Database01,
    path: "knowledge",
    description: "What your tenant actually believes, claim by claim.",
    section: "main",
  },
  {
    id: "goals",
    label: "Goals",
    icon: Target04,
    path: "goals",
    description: "This quarter's five goals and how they are tracking.",
    section: "main",
  },
  {
    id: "site",
    label: "Site",
    icon: Globe01,
    path: "site",
    description: "Your blog: address, custom domain and theme.",
    section: "main",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageChatCircle,
    path: "chat",
    description: "Ask the agent anything about your content and knowledge base.",
    section: "main",
  },
  {
    id: "connections",
    label: "Connections",
    icon: Dataflow03,
    path: "connections",
    description: "Where Propaganda listens: calls, Slack and documents.",
    section: "main",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings01,
    path: "settings",
    description: "People, content, agents and this tenant's details.",
    section: "footer",
    // Opens the 0.1 settings dialog until the Settings thread lands.
    component: lazy(() => import("@/components/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))),
  },
];

export function findPage(path: string): PageRoute | undefined {
  return PAGES.find((p) => p.path === path);
}
