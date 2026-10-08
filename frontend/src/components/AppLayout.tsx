import { ReactNode } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  StickyNote,
  Tag,
  Settings as SettingsIcon,
  Menu,
  GlobeAlt,
  Clock,
  Lock,
  BarChart3,
  FolderOpen,
  Squares2x2,
} from "@/lib/heroicons";
import {
  Squares2X2Icon as Squares2x2Solid,
  DocumentTextIcon as StickyNoteSolid,
  TagIcon as TagSolid,
  ChartBarIcon as BarChart3Solid,
} from "@heroicons/react/24/solid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { SessionNavBar } from "@/components/ui/session-nav-bar";
import { useLanguage } from "@/contexts/LanguageContext";
import { VaultPicker } from "@/components/AccountExtras";
import { OfflineStatus } from "@/components/offline/OfflineStatus";

// Primary tabs shown in the bottom navigation bar on mobile.
const mobileTabs = [
  { to: "/notes", icon: StickyNote, iconSolid: StickyNoteSolid, key: "nav_notes" },
  { to: "/entities", icon: Tag, iconSolid: TagSolid, key: "nav_entities" },
  { to: "/insights", icon: BarChart3, iconSolid: BarChart3Solid, key: "nav_insights" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const isGraphPage = location.pathname.startsWith("/graph");
  const isNoteEditor = /^\/notes\/[^/]+$/.test(location.pathname);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <CommandPalette />
      <VaultPicker />
      {/* Desktop hover-expand sidebar */}
      <SessionNavBar />

      <main className="min-w-0 flex-1 overflow-visible bg-background lg:ml-[3.25rem] lg:overflow-auto">
        {children}
        {/* Spacer so content isn't hidden behind the floating mobile bottom nav */}
        {!isNoteEditor && <div className="h-[calc(5.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] lg:hidden" />}
      </main>


      {/* Desktop offline / sync indicator — floating top-right pill */}
      <div className="pointer-events-none fixed right-4 top-4 z-40 hidden lg:block">
        <div className="pointer-events-auto rounded-full border border-border/10 bg-background/80 px-1 py-0.5 shadow-sm backdrop-blur">
          <OfflineStatus compact />
        </div>
      </div>

      {/* Mobile bottom tab bar — floating, rounded */}
      {!isGraphPage && !isNoteEditor && (
        <nav
          className="fixed inset-x-3 z-40 lg:hidden"
          style={{
            bottom: "calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 0.75rem)",
            width: "calc(100% - 20%)",
            left: "10%",
          }}
        >
          <div className="flex items-center justify-around gap-0.5 rounded-2xl border border-border/10 bg-muted/60 px-1 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-[6px] supports-[backdrop-filter]:bg-muted/60">
            {mobileTabs.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) =>
                  cn(
                    "flex flex-1 items-center justify-center rounded-xl px-1 py-1.5 transition-all active:scale-95",
                    isActive ? "bg-foreground/8 text-foreground" : "text-muted-foreground",
                  )
                }
              >
                {({ isActive }) => {
                  const IconEl = isActive && it.iconSolid ? it.iconSolid : it.icon;
                  return (
                    <>
                      <span className="sr-only">{t(it.key)}</span>
                      <span className="grid h-7 w-7 place-items-center rounded-lg">
                        <IconEl className="h-5 w-5" />
                      </span>
                    </>
                  );
                }}
              </NavLink>
            ))}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center rounded-xl px-1 py-1.5 text-muted-foreground transition-all active:scale-95 data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
                  aria-label={t("nav_more")}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg">
                    <Menu className="h-5 w-5" />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="mb-2 w-56 bg-muted/60 backdrop-blur-[6px]">
                <DropdownMenuItem onSelect={() => navigate("/projects")}>
                  <FolderOpen className="mr-2 h-4 w-4" /> {t("nav_projects")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/activities")}>
                  <Clock className="mr-2 h-4 w-4" /> {t("nav_activities")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/graph")}>
                  <GlobeAlt className="mr-2 h-4 w-4" /> {t("nav_graph")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/vault")}>
                  <Lock className="mr-2 h-4 w-4" /> {t("nav_vault")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">{user?.email}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => navigate("/settings")}>
                  <SettingsIcon className="mr-2 h-4 w-4" /> {t("nav_settings")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </nav>
      )}


    </div>
  );
}
