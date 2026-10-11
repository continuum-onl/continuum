"use client";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion } from "framer-motion";
import {
  Activity,
  HardDrive,
  LayoutDashboard,
  GlobeAlt,
  Search,
  StickyNote,
  Tag,
  Timer,
  UserCircle,
  Lock,
  Clock,
  FolderOpen,
  BarChart3,
  Squares2x2,
} from "@/lib/heroicons";
import {
  Squares2X2Icon as Squares2x2Solid,
  DocumentTextIcon as StickyNoteSolid,
  TagIcon as TagSolid,
  LockClosedIcon as LockSolid,
  FolderOpenIcon as FolderOpenSolid,
  ClockIcon as ClockSolid,
  ChartBarIcon as BarChart3Solid,
  GlobeAltIcon as GlobeAltSolid,
} from "@heroicons/react/24/solid";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
// dropdown-menu not used here anymore

const sidebarVariants = {
  open: { width: "15rem" },
  closed: { width: "3.25rem" },
};

const labelVariants = {
  open: { opacity: 1, x: 0, transition: { duration: 0.15 } },
  closed: { opacity: 0, x: -8, transition: { duration: 0.1 } },
};

const transitionProps = {
  type: "tween" as const,
  ease: "easeOut" as const,
  duration: 0.2,
};

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconSolid?: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const primaryNav: NavItem[] = [
  { to: "/notes", label: "nav_notes", icon: StickyNote, iconSolid: StickyNoteSolid },
  { to: "/entities", label: "nav_entities", icon: Tag, iconSolid: TagSolid },
  { to: "/vault", label: "nav_vault", icon: Lock, iconSolid: LockSolid },
];

const trackingNav: NavItem[] = [
  { to: "/projects", label: "nav_projects", icon: FolderOpen, iconSolid: FolderOpenSolid },
  { to: "/activities", label: "nav_activities", icon: Clock, iconSolid: ClockSolid },
];

const exploreNav: NavItem[] = [
  { to: "/insights", label: "nav_insights", icon: BarChart3, iconSolid: BarChart3Solid },
  { to: "/graph", label: "nav_graph", icon: GlobeAlt, iconSolid: GlobeAltSolid },
];

function SidebarLink({
  item,
  collapsed,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}) {
  const { t } = useLanguage();
  const active = item.end
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(item.to + "/");
  const Icon = active && item.iconSolid ? item.iconSolid : item.icon;
  const label = t(item.label);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? label : undefined}
      className={cn(
        "flex h-9 w-full flex-row items-center rounded-md px-2 transition-colors",
        active
          ? "text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <motion.span
        variants={labelVariants}
        className="ml-2 truncate text-sm font-medium"
      >
        {!collapsed && label}
      </motion.span>
    </NavLink>
  );
}

export function SessionNavBar() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { theme } = useTheme();

  const initial = (user?.username || user?.email || "U").trim().charAt(0).toUpperCase();
  const display = user?.username || user?.email?.split("@")[0] || "Guest";

  return (
    <motion.aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden h-full shrink-0 lg:flex",
        "border-r border-sidebar-border/10 bg-sidebar/85 backdrop-blur-xl",
      )}
      initial={false}
      animate={isCollapsed ? "closed" : "open"}
      variants={sidebarVariants}
      transition={transitionProps}
      onMouseEnter={() => setIsCollapsed(false)}
      onMouseLeave={() => setIsCollapsed(true)}
    >
      <div className="relative z-40 flex h-full w-full flex-col text-sidebar-foreground">
        {/* Brand / search trigger */}
        <div className="flex h-[54px] w-full shrink-0 items-center border-b border-sidebar-border/10 px-2">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
          >
            <img
              src={theme === "LIGHT" ? "/icon-light.png" : "/icon-transparent.png"}
              alt="Continuum"
              className="h-6 w-6 shrink-0 rounded object-contain"
            />
            <motion.span
              variants={labelVariants}
              className="truncate text-sm font-serif tracking-tight text-sidebar-accent-foreground"
            >
              {!isCollapsed && "Continuum"}
            </motion.span>
          </button>
        </div>

        <div className="flex h-full w-full flex-col">
          <ScrollArea className="grow">
            <div className="flex flex-col gap-1 p-2">
              <button
                type="button"
                onClick={() => {
                  // Trigger Ctrl+K command palette (dispatch on document so listeners on document receive it)
                  document.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
                  );
                }}
                className="flex h-9 w-full items-center rounded-md px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title={t("common_search")}
              >
                <Search className="h-4 w-4 shrink-0" />
                <motion.span variants={labelVariants} className="ml-2 truncate text-sm font-medium">
                  {!isCollapsed && t("common_search")}
                </motion.span>
                <motion.span
                  variants={labelVariants}
                  className="ml-auto rounded border border-sidebar-border/10 px-1.5 py-0.5 font-mono text-[10px] text-sidebar-foreground/70"
                >
                  {!isCollapsed && "Ctrl+K"}
                </motion.span>
              </button>

              <Separator className="my-2 bg-sidebar-border/10" />

              {primaryNav.map((it) => (
                <SidebarLink key={it.to} item={it} collapsed={isCollapsed} pathname={pathname} />
              ))}

              <Separator className="my-2 bg-sidebar-border/10" />

              {trackingNav.map((it) => (
                <SidebarLink key={it.to} item={it} collapsed={isCollapsed} pathname={pathname} />
              ))}

              <Separator className="my-2 bg-sidebar-border/10" />

              {exploreNav.map((it) => (
                <SidebarLink key={it.to} item={it} collapsed={isCollapsed} pathname={pathname} />
              ))}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex flex-col gap-1 border-t border-sidebar-border/10 p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="flex h-9 items-center gap-2 rounded-md px-2 text-sidebar-foreground"
              >
                <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sidebar-primary text-[10px] font-bold text-sidebar-primary-foreground">
                  {initial}
                </div>
                <motion.span variants={labelVariants} className="flex items-center gap-2 overflow-hidden">
                  {!isCollapsed && <span className="truncate text-sm font-medium normal-case tracking-normal">{display}</span>}
                </motion.span>
              </button>

              {/* No logout button here — profile page handles sign out */}
            </div>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
