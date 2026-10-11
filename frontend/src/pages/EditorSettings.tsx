import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import WallpaperSettings from "@/components/profile/WallpaperSettings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { AdjustmentsHorizontalIcon, ArrowLeftIcon, CheckIcon, EyeIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { DEFAULT_NOTE_FONT_SIZE, loadNoteFontSize, saveNoteFontSize, subscribeNoteFontSize } from "@/lib/note-font-size";
import { loadWallpaperSettings, resolveVaultBlobFast, saveWallpaperSettings, subscribeWallpaper, type NoteWallpaperSettings } from "@/lib/note-wallpaper";

export default function EditorSettingsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [draftNoteTitleScale, setDraftNoteTitleScale] = useState(() => loadNoteFontSize().titleScale);
  const [draftNoteBodyScale, setDraftNoteBodyScale] = useState(() => loadNoteFontSize().bodyScale);
  const [draftWallpaper, setDraftWallpaper] = useState<NoteWallpaperSettings>(() => loadWallpaperSettings());
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [panel, setPanel] = useState<"text" | "wallpaper" | null>(null);

  useEffect(() => subscribeNoteFontSize((settings) => {
    setDraftNoteTitleScale(settings.titleScale);
    setDraftNoteBodyScale(settings.bodyScale);
  }), []);

  useEffect(() => subscribeWallpaper(setDraftWallpaper), []);

  useEffect(() => {
    let active = true;
    if (!draftWallpaper.fileId) {
      setWallpaperUrl(null);
      return () => { active = false; };
    }
    resolveVaultBlobFast(draftWallpaper.fileId)
      .then((url) => { if (active) setWallpaperUrl(url); })
      .catch(() => { if (active) setWallpaperUrl(null); });
    return () => { active = false; };
  }, [draftWallpaper.fileId]);

  const resetNoteFontScale = () => {
    setDraftNoteTitleScale(DEFAULT_NOTE_FONT_SIZE.titleScale);
    setDraftNoteBodyScale(DEFAULT_NOTE_FONT_SIZE.bodyScale);
    saveNoteFontSize(DEFAULT_NOTE_FONT_SIZE);
  };

  const updateTitleScale = (value: number) => {
    setDraftNoteTitleScale(value);
    saveNoteFontSize({ titleScale: value, bodyScale: draftNoteBodyScale });
  };

  const updateBodyScale = (value: number) => {
    setDraftNoteBodyScale(value);
    saveNoteFontSize({ titleScale: draftNoteTitleScale, bodyScale: value });
  };

  const updateWallpaper = (value: NoteWallpaperSettings) => {
    setDraftWallpaper(value);
    saveWallpaperSettings(value);
  };

  return (
    <AppLayout>
      <div className="fixed inset-0 z-0 overflow-hidden bg-background lg:relative lg:inset-auto lg:h-dvh lg:min-h-[620px]">
          <section className="absolute inset-0 overflow-hidden bg-background">
            {wallpaperUrl && (
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${wallpaperUrl})`,
                  filter: `blur(${draftWallpaper.blur}px) brightness(${draftWallpaper.brightness}%)`,
                  transform: draftWallpaper.blur > 0 ? "scale(1.08)" : undefined,
                }}
              />
            )}
            {wallpaperUrl && <div aria-hidden="true" className="absolute inset-0 bg-background/55" />}

            <div className="relative flex h-full flex-col">
              <header className="flex shrink-0 items-center justify-between border-b border-border/5 bg-background/70 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-md lg:pt-3">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="icon" aria-label={t("common_back")} onClick={() => navigate(-1)} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <ArrowLeftIcon className="h-4 w-4" />
                  </Button>
                  <div className="mx-2 h-4 w-px bg-border/10" />
                  <span className="flex items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    <CheckIcon className="h-3 w-3 text-emerald-400" /> {t("ed_saved")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="ghost" size="icon" aria-label={t("ed_view_mode")} className="pointer-events-none h-8 w-8 bg-primary/20 text-primary">
                    <EyeIcon className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("ed_toggle_side_panel")} className="pointer-events-none h-8 w-8 text-muted-foreground">
                    <Squares2X2Icon className="h-4 w-4" />
                  </Button>
                </div>
              </header>

              <div className="flex-1 overflow-hidden px-7 py-10 pb-56 sm:px-12 sm:py-14 lg:pb-40">
                <div className="mx-auto max-w-[680px]">
                  <h2
                    className="font-display font-bold leading-tight text-foreground"
                    style={{ fontSize: `${Math.max(1.8, 3.1 * (draftNoteTitleScale / 100))}rem` }}
                  >
                    Lorem ipsum
                  </h2>
                  <div
                    className="mt-8 space-y-4 leading-relaxed text-foreground/85"
                    style={{ fontSize: `${draftNoteBodyScale}%` }}
                  >
                    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
                    <h3 className="font-serif text-[1.35em] font-semibold text-foreground">Dolor sit amet</h3>
                    <p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
                    <blockquote className="border-l-2 border-border/20 pl-4 italic text-muted-foreground">
                      Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.
                    </blockquote>
                  </div>
                </div>
              </div>

              <div className="hidden h-8 shrink-0 items-center gap-3 border-t border-border/10 bg-background/55 px-3 font-mono text-[9px] text-muted-foreground backdrop-blur-md sm:flex">
                <span>34 words</span><span>·</span><span>219 characters</span><span className="ml-auto">1 min read</span>
              </div>
            </div>
          </section>

          <div className="pointer-events-none absolute inset-x-0 bottom-[calc(6rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] flex flex-col items-center gap-2 px-3 lg:bottom-6">
            {panel && (
              <div className="pointer-events-auto w-full max-w-md max-h-[45dvh] overflow-y-auto rounded-2xl border border-border/10 bg-background/80 px-4 shadow-lg backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2">
                {panel === "text" ? (
                  <div className="space-y-4 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{t("profile_noteFontSize")}</p>
                      <Button type="button" variant="ghost" size="sm" onClick={resetNoteFontScale} className="h-6 px-2 text-[10px] normal-case text-muted-foreground">
                        {t("common_reset")}
                      </Button>
                    </div>
                    {([
                      ["profile_fontTitle", draftNoteTitleScale, updateTitleScale],
                      ["profile_fontBody", draftNoteBodyScale, updateBodyScale],
                    ] as const).map(([label, value, update]) => (
                      <div key={label} className="flex items-center gap-3">
                        <Label className="w-14 shrink-0 text-[11px] text-muted-foreground">{t(label)}</Label>
                        <input type="range" min={80} max={180} step={5} value={value} onChange={(e) => update(Number(e.target.value))} className="h-1 flex-1 accent-primary" />
                        <span className="w-9 text-right font-mono text-[10px] text-muted-foreground">{value}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <WallpaperSettings value={draftWallpaper} onChange={updateWallpaper} />
                )}
              </div>
            )}
            <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/10 bg-background/70 p-1 shadow-md backdrop-blur-xl">
              {([
                ["text", AdjustmentsHorizontalIcon, t("profile_noteFontSize")],
                ["wallpaper", Squares2X2Icon, "Wallpaper"],
              ] as const).map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPanel(panel === key ? null : key)}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] transition-colors ${panel === key ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
      </div>
    </AppLayout>
  );
}