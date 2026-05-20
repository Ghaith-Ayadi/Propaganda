// Minimal dropdown menu built on react-aria-components — same API surface
// Genesis's full Dropdown exposes, without the radio/toggle/etc. deps.

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger as AriaMenuTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { cx } from "@/utils/cx";

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onAction: () => void;
}

export function ActionMenu({
  trigger,
  items,
  placement = "bottom end",
  triggerClassName,
}: {
  trigger: ReactNode;
  items: MenuAction[];
  placement?: "bottom start" | "bottom end" | "top start" | "top end";
  triggerClassName?: string;
}) {
  return (
    <AriaMenuTrigger>
      <AriaButton
        className={
          triggerClassName ??
          "rounded-md text-quaternary outline-none transition hover:bg-primary_hover hover:text-secondary data-[pressed]:bg-primary_hover"
        }
      >
        {trigger}
      </AriaButton>
      <AriaPopover
        placement={placement}
        className={cx(
          "z-50 min-w-[200px] rounded-xl border border-secondary bg-secondary p-1.5 shadow-2xl ring-1 ring-primary",
          "entering:animate-in entering:fade-in entering:zoom-in-95 entering:duration-100",
          "exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:duration-75",
        )}
      >
        <AriaMenu className="outline-none">
          {items.map((it) => (
            <AriaMenuItem
              key={it.id}
              isDisabled={it.disabled}
              onAction={it.onAction}
              className={cx(
                "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition",
                it.destructive
                  ? "text-error-primary hover:bg-error-primary/10 focus:bg-error-primary/10"
                  : "text-secondary hover:bg-tertiary focus:bg-tertiary hover:text-primary focus:text-primary",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {it.icon && <span className="shrink-0 text-quaternary">{it.icon}</span>}
              <span>{it.label}</span>
            </AriaMenuItem>
          ))}
        </AriaMenu>
      </AriaPopover>
    </AriaMenuTrigger>
  );
}
