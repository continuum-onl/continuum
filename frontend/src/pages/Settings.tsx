import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import SubscriptionContent from "@/components/subscription/SubscriptionContent";
import { useAuth } from "@/contexts/AuthContext";
import { authApi, importApi } from "@/lib/api";
import { version } from "@/lib/version";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ArrowDownTrayIcon,
  ArrowRightOnRectangleIcon,
  ArrowUpTrayIcon,
  BugAntIcon,
  ChatBubbleLeftEllipsisIcon,
  ChevronRightIcon,
  CodeBracketIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  LifebuoyIcon,
  LinkIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import MarkdownImportDialog from "@/components/import/MarkdownImportDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useExtrasText, useDeletionStatus } from "@/components/AccountExtras";
import { useQueryClient } from "@tanstack/react-query";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

type Lang = "en" | "es" | "pt" | "fr";

const SECTION_TITLES: Record<
  "account" | "preferences" | "data" | "support" | "legal" | "actions",
  Record<Lang, string>
> = {
  account: { pt: "Conta e Assinatura", en: "Account & Subscription", es: "Cuenta y suscripción", fr: "Compte et abonnement" },
  preferences: { pt: "Preferências", en: "Preferences", es: "Preferencias", fr: "Préférences" },
  data: { pt: "Dados e Integrações", en: "Data & Integrations", es: "Datos e integraciones", fr: "Données et intégrations" },
  support: { pt: "Suporte e Feedback", en: "Support & Feedback", es: "Soporte y comentarios", fr: "Support et retours" },
  legal: { pt: "Sobre e Legal", en: "About & Legal", es: "Acerca de y legal", fr: "À propos et mentions légales" },
  actions: { pt: "Ações da Conta", en: "Account Actions", es: "Acciones de la cuenta", fr: "Actions du compte" },
};
const GITHUB_URL = "https://github.com/continuumnodes/continuum";

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

type RowIcon = ComponentType<{ className?: string }>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border/10 pt-6 first:border-t-0 first:pt-0">
      <h2 className="font-serif text-xl text-foreground">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

interface ActionRowProps {
  icon: RowIcon;
  label: string;
  description?: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  destructive?: boolean;
}

function ActionRow({ icon: Icon, label, description, onClick, href, disabled = false, destructive = false }: ActionRowProps) {
  const content = (
    <>
      <Icon className={`h-5 w-5 shrink-0 ${destructive ? "text-destructive" : "text-muted-foreground"}`} />
      <span className="min-w-0 flex-1 text-left">
        <span className={`block text-sm font-medium ${destructive ? "text-destructive" : "text-foreground/80"}`}>{label}</span>
        {description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );
  const className =
    "flex h-16 w-full items-center gap-4 py-0 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";

  if (href) {
    const external = href.startsWith("http");
    return (
      <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}

/* Custom icons */

function VisionIcon({ className }: { className?: string }) {
  return <img src="/vision-symbol.png" alt="" aria-hidden="true" className={`${className ?? ""} rounded-full object-cover`} />;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const x = useExtrasText();
  const qc = useQueryClient();
  const { data: del } = useDeletionStatus();

  const [exporting, setExporting] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNowOpen, setDeleteNowOpen] = useState(false);
  const [cancelDeletionOpen, setCancelDeletionOpen] = useState(false);
  const [cancelingDeletion, setCancelingDeletion] = useState(false);
  const [deletingNow, setDeletingNow] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(() => new URLSearchParams(window.location.search).has("status"));

  const title = (key: keyof typeof SECTION_TITLES) => SECTION_TITLES[key][language as Lang] ?? SECTION_TITLES[key].en;

  /* Handlers */

  const handleExportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await authApi.exportData();
      const json = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "continuum-backup.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: t("profile_backupOk") });
    } catch (error: any) {
      toast({ title: t("profile_backupFailed"), description: error?.message ?? t("common_tryAgain"), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleRelinkEntities = async () => {
    if (relinking) return;
    setRelinking(true);
    try {
      const res = await importApi.relinkEntities();
      const data = res.data as { notesUpdated?: number; connectionsCreated?: number };
      toast({
        title: t("import_relinkDoneTitle"),
        description: t("import_relinkDoneDesc", { n: data.connectionsCreated ?? 0, notes: data.notesUpdated ?? 0 }),
      });
    } catch (error: any) {
      toast({
        title: t("profile_relinkFailed"),
        description: error?.response?.data?.message || error?.message || t("profile_relinkFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setRelinking(false);
    }
  };

  const handleDelete = async () => {
    try {
      await authApi.scheduleDeletion();
      await qc.invalidateQueries({ queryKey: ["account", "deletion"] });
    } catch (error: any) {
      toast({ title: t("common_tryAgain"), description: error?.message, variant: "destructive" });
    }
  };

  const handleCancelDeletion = async () => {
    if (cancelingDeletion) return;
    setCancelingDeletion(true);
    try {
      await authApi.cancelDeletion();
      await qc.invalidateQueries({ queryKey: ["account", "deletion"] });
      toast({ title: x.canceled, notificationCategory: "account-deletion" });
    } catch (error: unknown) {
      toast({
        title: t("common_tryAgain"),
        description: error instanceof Error ? error.message : t("common_tryAgain"),
        variant: "destructive",
      });
    } finally {
      setCancelingDeletion(false);
    }
  };

  const handleDeleteNow = async () => {
    if (deletingNow) return;
    setDeletingNow(true);
    try {
      await authApi.deleteScheduledAccountNow();
      await logout();
      navigate("/", { replace: true });
    } catch (error: unknown) {
      toast({
        title: t("common_tryAgain"),
        description: error instanceof Error ? error.message : t("common_tryAgain"),
        variant: "destructive",
      });
    } finally {
      setDeletingNow(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  /* Derived */

  const deletionPending = !!(del?.scheduled || del?.deletionRequestedAt);
  const dateLocale = { en: "en-US", es: "es-ES", pt: "pt-BR", fr: "fr-FR" }[language];
  const deletionDescription = del?.purgeAt
    ? x.delDesc.replace("{d}", new Intl.DateTimeFormat(dateLocale).format(new Date(del.purgeAt)))
    : x.delTitle;

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-6 lg:px-10 lg:py-12">
        {/* 1. Conta e Assinatura */}
        <Section title={title("account")}>
          <ActionRow icon={VisionIcon} label={t("profile_continuumSubscription")} onClick={() => setSubscriptionOpen(true)} />
          <ActionRow icon={CurrencyDollarIcon} label={t("lp_footer_pricing")} href="/pricing" />
        </Section>

        {/* 2. Preferências */}
        <Section title={title("preferences")}>
          <ActionRow icon={PencilSquareIcon} label={t("nav_editorSettings")} href="/editor" />
          <LanguageSelector />
        </Section>

        {/* 3. Dados e Integrações */}
        <Section title={title("data")}>
          <ActionRow icon={ArrowUpTrayIcon} label={t("profile_importMd")} description={t("profile_importMdDesc")} onClick={() => setImportOpen(true)} />
          <ActionRow
            icon={ArrowDownTrayIcon}
            label={t("profile_exportData")}
            description={user?.dataExport ? "continuum-backup.json" : t("profile_locked")}
            onClick={handleExportData}
            disabled={exporting || !user?.dataExport}
          />
          <ActionRow icon={LinkIcon} label={t("import_relinkBtn")} description={t("profile_relinkDesc")} onClick={handleRelinkEntities} disabled={relinking} />
          <ActionRow icon={TrashIcon} label={t("nav_trash")} description={t("nav_trash_desc")} href="/trash" />
        </Section>

        {/* 4. Suporte e Feedback */}
        <Section title={title("support")}>
          <ActionRow icon={LifebuoyIcon} label={t("profile_supportCenter")} description={t("profile_supportCenterDesc")} href="/support" />
          <ActionRow
            icon={ChatBubbleLeftEllipsisIcon}
            label={t("profile_sendFeedback")}
            description="feedback@continuum.onl"
            href="mailto:feedback@continuum.onl?subject=Continuum%20%E2%80%94%20Feedback"
          />
          <ActionRow
            icon={BugAntIcon}
            label={t("profile_reportBug")}
            description="bugs@continuum.onl"
            href="mailto:bugs@continuum.onl?subject=Continuum%20%E2%80%94%20Bug%20report"
          />
        </Section>

        {/* 5. Sobre e Legal */}
        <Section title={title("legal")}>
          <ActionRow icon={InformationCircleIcon} label={t("lp_footer_about")} href="/about" />
          <ActionRow icon={CodeBracketIcon} label="GitHub" href={GITHUB_URL} />
          <ActionRow icon={DocumentTextIcon} label={t("lp_footer_terms")} href="/terms" />
          <ActionRow icon={ShieldCheckIcon} label={t("lp_footer_privacy")} href="/privacy" />
        </Section>

        {/* 6. Ações da Conta */}
        <Section title={title("actions")}>
          <ActionRow
            icon={TrashIcon}
            label={deletionPending ? x.cancel : x.deleteAccount}
            description={deletionPending ? deletionDescription : x.deleteAccountDesc}
            onClick={() => (deletionPending ? setCancelDeletionOpen(true) : setDeleteOpen(true))}
            disabled={cancelingDeletion}
            destructive={deletionPending}
          />
          {deletionPending && (
            <ActionRow
              icon={TrashIcon}
              label={x.deleteNow}
              description={x.deleteNowDescription}
              onClick={() => setDeleteNowOpen(true)}
              disabled={deletingNow}
              destructive
            />
          )}
          <ActionRow icon={ArrowRightOnRectangleIcon} label={t("nav_logout")} onClick={() => setLogoutConfirmOpen(true)} destructive />
        </Section>

        {/* 7. Rodapé */}
        <footer className="flex w-full justify-center pb-4">
          <a href="/versions" className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground">
            {version} · Versions
          </a>
        </footer>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={x.deleteAccount}
        description={x.deleteConfirm}
        confirmText={x.deleteAccount}
        confirmationPhrase="CONFIRM"
        confirmationPrompt={t("account_deleteConfirmPrompt")}
        destructive
        onConfirm={async () => {
          setDeleteOpen(false);
          await handleDelete();
        }}
      />
      <ConfirmDialog
        open={cancelDeletionOpen}
        onOpenChange={setCancelDeletionOpen}
        title={x.cancelConfirmTitle}
        description={x.cancelConfirmDesc}
        confirmText={x.cancel}
        onConfirm={async () => {
          setCancelDeletionOpen(false);
          await handleCancelDeletion();
        }}
      />
      <ConfirmDialog
        open={deleteNowOpen}
        onOpenChange={setDeleteNowOpen}
        title={x.deleteNowConfirmTitle}
        description={x.deleteNowConfirmDescription}
        confirmText={x.deleteNow}
        confirmationPhrase="CONFIRM"
        confirmationPrompt={t("account_deleteNowConfirmPrompt")}
        destructive
        onConfirm={async () => {
          setDeleteNowOpen(false);
          await handleDeleteNow();
        }}
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title={t("auth_signOut")}
        description={t("auth_signOutDesc")}
        confirmText={t("nav_logout")}
        destructive
        onConfirm={async () => {
          setLogoutConfirmOpen(false);
          await handleLogout();
        }}
      />
      <MarkdownImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => refreshUser()} />

      {subscriptionOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-0 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-subscription-panel]")) setSubscriptionOpen(false);
          }}
        >
          <div className="w-full">
            <SubscriptionContent />
          </div>
        </div>
      )}
    </AppLayout>
  );
}
