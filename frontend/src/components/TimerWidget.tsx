import { useState, useEffect, useRef } from 'react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { useTodayTimeStats } from '@/hooks/useTodayTimeStats';
import { ensureNotificationPermission, primeEntityName } from '@/lib/timer-notifications';
import { useLanguage } from '@/contexts/LanguageContext';


// ============================================================
// SUBCOMPONENTE: FlipDigit (Alinhamento Robusto e Sem Falhas)
// ============================================================
function FlipDigit({ value, animate = true }: { value: string; animate?: boolean }) {
  const [prevValue, setPrevValue] = useState(value);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    if (value !== prevValue) {
      if (!animate) {
        setPrevValue(value);
        setIsFlipping(false);
        return;
      }

      setIsFlipping(true);
      const timeout = setTimeout(() => {
        setPrevValue(value);
        setIsFlipping(false);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [animate, value, prevValue]);

  const displayedPreviousValue = animate ? prevValue : value;

  return (
    <div className="relative w-20 h-28 sm:w-28 sm:h-40 lg:w-32 lg:h-48 font-mono font-bold text-foreground select-none [perspective:1000px]">
      
      <style>{`
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .anim-top { animation: flip-top-fall 0.25s ease-in forwards; }
        .anim-bottom { animation: flip-bottom-reveal 0.25s ease-out 0.25s forwards; }
        @keyframes flip-top-fall { 0% { transform: rotateX(0deg); } 100% { transform: rotateX(-90deg); } }
        @keyframes flip-bottom-reveal { 0% { transform: rotateX(90deg); } 100% { transform: rotateX(0deg); } }
      `}</style>

      {/* 1. TOPO BASE */}
      <div className="absolute top-0 left-0 w-full h-1/2 overflow-hidden rounded-t-xl bg-gradient-to-b from-card to-background border-b border-border/30">
        <div className="absolute top-0 left-0 w-full h-[200%] flex items-center justify-center text-6xl sm:text-8xl lg:text-9xl leading-none">
          {value}
        </div>
      </div>

      {/* 2. BASE DE BAIXO */}
      <div className="absolute bottom-0 left-0 w-full h-1/2 overflow-hidden rounded-b-xl bg-gradient-to-b from-background to-card">
        <div className="absolute bottom-0 left-0 w-full h-[200%] flex items-center justify-center text-6xl sm:text-8xl lg:text-9xl leading-none">
          {displayedPreviousValue}
        </div>
      </div>

      {/* 3. CARTA QUE CAI DE CIMA */}
      <div className={`absolute top-0 left-0 w-full h-1/2 overflow-hidden rounded-t-xl bg-gradient-to-b from-card to-background border-b border-border/30 [transform-origin:bottom] backface-hidden ${isFlipping && animate ? 'anim-top' : ''}`}>
        <div className="absolute top-0 left-0 w-full h-[200%] flex items-center justify-center text-6xl sm:text-8xl lg:text-9xl leading-none">
          {displayedPreviousValue}
        </div>
      </div>

      {/* 4. CARTA QUE APARECE EM BAIXO */}
      <div className={`absolute bottom-0 left-0 w-full h-1/2 overflow-hidden rounded-b-xl bg-gradient-to-b from-background to-card [transform-origin:top] backface-hidden [transform:rotateX(90deg)] ${isFlipping && animate ? 'anim-bottom' : ''}`}>
        <div className="absolute bottom-0 left-0 w-full h-[200%] flex items-center justify-center text-6xl sm:text-8xl lg:text-9xl leading-none">
          {value}
        </div>
      </div>

      {/* FRISO CENTRAL */}
      <div className="absolute top-[calc(50%-1px)] left-0 w-full h-[2px] bg-border/40 z-10"></div>
    </div>
  );
}


// ============================================================
// INTERFACES
// ============================================================
interface TimerWidgetProps {
  entityId: string;
  entityName: string;
  onTimerStart?: (sessionId: string) => void;
  onTimerStop?: (duration: number) => void;
  compact?: boolean;
  showSectionBorders?: boolean;
}

// ============================================================
// COMPONENTE PRINCIPAL: TimerWidget
// Visual do novo + lógica de save do antigo (useTimeTracking)
// ============================================================
export function TimerWidget({
  entityId,
  entityName,
  onTimerStart,
  onTimerStop,
  compact = false,
  showSectionBorders = true,
}: TimerWidgetProps) {
  const { t } = useLanguage();
  const {
    activeTimers,
    isTimerActive,
    getElapsedSeconds,
    startTimer,
    stopTimer,
    isStarting,
    isStopping,
    getActiveTimer,
    formatSeconds,
    isTimerPaused,
    pauseTimer,
    resumeTimer,
  } = useTimeTracking();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [hasStoppedTimer, setHasStoppedTimer] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: activeTimer, isLoading: timerLoading } = getActiveTimer(entityId);
  const isRunning = isTimerActive(entityId);
  const isPaused = isTimerPaused(entityId);
  const today = useTodayTimeStats(entityId);



  const currentElapsed = isRunning
    ? getElapsedSeconds(entityId)
    : hasStoppedTimer
      ? 0
      : (activeTimer?.elapsedSeconds || 0);

  const timeString = formatSeconds(currentElapsed);

  // Deriva dígitos do timeString "HH:MM:SS"
  const [hh, mm, ss] = timeString.split(':');
  const hrs = (hh || '00').padStart(2, '0');
  const mins = (mm || '00').padStart(2, '0');
  const secs = (ss || '00').padStart(2, '0');

  // Gerencia ativação do Fullscreen Nativo
  useEffect(() => {
    if (isFullscreen) {
      const elem = fullscreenContainerRef.current;
      if (elem?.requestFullscreen) {
        elem.requestFullscreen()
          .then(() => {
            // After entering fullscreen, lock to landscape on mobile devices.
            const isCoarse =
              typeof window !== 'undefined' &&
              (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768);
            if (isCoarse) {
              const orientation = (screen as any)?.orientation;
              if (orientation && typeof orientation.lock === 'function') {
                orientation.lock('landscape').catch((err: unknown) => {
                  console.warn('Orientation lock unavailable:', err);
                });
              }
            }
          })
          .catch((err) => console.warn('Erro ao forçar fullscreen:', err));
      }
    } else {
      const orientation = (screen as any)?.orientation;
      if (orientation && typeof orientation.unlock === 'function') {
        try { orientation.unlock(); } catch (err) { console.warn(err); }
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((err) => console.warn(err));
      }
    }
  }, [isFullscreen]);

  // Sincroniza se o usuário sair do fullscreen pelo botão nativo
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleStart = async () => {
    try {
      setHasStoppedTimer(false);
      primeEntityName(entityId, entityName);
      void ensureNotificationPermission();
      await startTimer(entityId);
      onTimerStart?.(entityId);
    } catch (error) {
      console.error('Failed to start timer:', error);
    }
  };

  const handleStop = async () => {
    setHasStoppedTimer(true);
    try {
      const activeTimerData = activeTimers.get(entityId);
      if (activeTimerData) {
        await stopTimer({ sessionId: activeTimerData.timerId });
        onTimerStop?.(currentElapsed);
      }
    } catch (error) {
      console.error('Failed to stop timer:', error);
    }
  };

  const handlePauseToggle = () => {
    if (!isRunning) return;
    if (isPaused) resumeTimer(entityId);
    else pauseTimer(entityId);
  };

  const handleRestart = async () => {
    try {
      const activeTimerData = activeTimers.get(entityId);
      if (activeTimerData) {
        await stopTimer({ sessionId: activeTimerData.timerId });
      }
      await startTimer(entityId);
    } catch (error) {
      console.error('Failed to restart timer:', error);
    }
  };

  // Reveal hover controls; auto-hide on touch after a brief delay.
  const revealControls = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2000);
  };

  // On entering fullscreen: briefly reveal controls, then auto-hide after 2s.
  useEffect(() => {
    if (!isFullscreen) return;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2000);
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isFullscreen]);


  // Modo compacto (igual ao antigo)
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-zinc-400">{timeString}</span>
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={isStopping}
            title={t("tm_stop_timer")}
            className="h-6 w-6 flex items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition text-xs"
          >
            ■
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={isStarting}
            title={t("tm_start_timer")}
            className="h-6 w-6 flex items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition text-xs"
          >
            ▶
          </button>
        )}
      </div>
    );
  }

  return (
    <section className={`${showSectionBorders ? "border-y border-border/10" : ""} py-5 text-foreground sm:py-6`}>
      {/* Header — Activity aesthetic */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{t("tm_timer")}</p>
          <h3 className="mt-1 break-words font-serif text-xl leading-snug text-foreground">{entityName}</h3>
        </div>
        <span className="rounded-full border border-border/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {isRunning ? (isPaused ? t("tm_paused") : t("tm_running")) : t("tm_idle")}
        </span>
      </div>

      {/* Clock readout */}
      <div className={`my-6 text-center font-mono text-4xl tracking-[0.12em] tabular-nums transition-colors sm:text-6xl sm:tracking-[0.2em] ${isPaused ? 'text-muted-foreground' : 'text-foreground'}`}>
        {hrs}:{mins}:{secs}
      </div>

      {timerLoading && (
        <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground text-center mb-3">{t("tm_loading_timer")}</p>
      )}

      {/* CONTROLS */}
      <div className={`mb-3 grid gap-2 ${isRunning ? "grid-cols-2" : "grid-cols-1"}`}>
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={isStarting || timerLoading}
            className="min-h-11 rounded-xl bg-secondary px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-secondary-foreground transition hover:bg-secondary/75 disabled:opacity-50 sm:text-[11px] sm:tracking-[0.2em]"
          >
            {isStarting ? t("tm_starting") : t("tm_start")}
          </button>
        ) : (
          <>
            <button
              onClick={handlePauseToggle}
              disabled={timerLoading}
              className="min-h-11 rounded-xl bg-secondary px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-secondary-foreground transition hover:bg-secondary/75 disabled:opacity-50 sm:text-[11px] sm:tracking-[0.2em]"
            >
              {isPaused ? t("tm_resume") : t("tm_pause")}
            </button>
            <button
              onClick={handleStop}
              disabled={isStopping || timerLoading}
              className="min-h-11 rounded-xl bg-secondary px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-secondary-foreground/70 transition hover:bg-secondary/75 hover:text-secondary-foreground disabled:opacity-50 sm:text-[11px] sm:tracking-[0.2em]"
            >
              {isStopping ? '…' : t("tm_stop")}
            </button>
            <button
              onClick={handleRestart}
              disabled={timerLoading}
              className="min-h-11 rounded-xl bg-secondary px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-secondary-foreground/70 transition hover:bg-secondary/75 hover:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-30 sm:text-[11px] sm:tracking-[0.2em]"
            >
              {t("tm_restart")}
            </button>
            <button
              onClick={() => setIsFullscreen(true)}
              className="min-h-11 rounded-xl bg-secondary px-2 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-secondary-foreground/70 transition hover:bg-secondary/75 hover:text-secondary-foreground sm:text-[10px] sm:tracking-[0.2em]"
            >
              {t("tm_flip_clock")}
            </button>
          </>
        )}
      </div>

      {/* TODAY SECTION — Activity stat grid */}
      <div className="mt-5 grid grid-cols-1 divide-y divide-border/10 border-y border-border/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SummaryStat label={t("tm_today")} value={formatSeconds(today.todaySeconds + (isRunning ? currentElapsed : 0))} />
        <SummaryStat label={t("tm_sessions")} value={today.todayEntriesCount} />
        <SummaryStat label={t("tm_avg")} value={formatSeconds(today.avgEntrySeconds)} />
      </div>



      {/* FULLSCREEN COM FLIPDIGIT ANIMADO */}
      {isFullscreen && (
        <div
          ref={fullscreenContainerRef}
          onMouseMove={revealControls}
          onMouseLeave={() => setShowControls(false)}
          onTouchStart={revealControls}
          className="fixed inset-0 w-screen h-[100dvh] z-50 flex flex-col justify-center items-center bg-background text-foreground select-none"
        >
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-6 right-6 text-muted-foreground hover:text-foreground text-2xl font-light w-12 h-12 flex items-center justify-center rounded-full border border-border/30 hover:border-border/60 transition bg-card hover:bg-accent z-10"
          >
            ✕
          </button>

          {/* Entity name in fullscreen */}
          <div className="absolute top-8 left-1/2 -translate-x-1/2 text-[11px] sm:text-xs font-mono tracking-[0.3em] text-muted-foreground uppercase">
            {entityName}{isPaused && <span className="ml-3 text-foreground">· {t("tm_paused_suffix")}</span>}
          </div>

          <div className={`flex items-center gap-1.5 sm:gap-3 md:gap-4 transition-opacity ${isPaused ? 'opacity-60' : 'opacity-100'}`}>
            <FlipDigit value={hrs[0]} animate={isRunning && !isPaused} />
            <FlipDigit value={hrs[1]} animate={isRunning && !isPaused} />

            <div className={`flex flex-col gap-2 sm:gap-4 px-1 opacity-40 ${isPaused ? '' : 'animate-pulse'}`}>
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-foreground rounded-full"></span>
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-foreground rounded-full"></span>
            </div>

            <FlipDigit value={mins[0]} animate={isRunning && !isPaused} />
            <FlipDigit value={mins[1]} animate={isRunning && !isPaused} />

            <div className={`flex flex-col gap-2 sm:gap-4 px-1 opacity-40 ${isPaused ? '' : 'animate-pulse'}`}>
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-foreground rounded-full"></span>
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-foreground rounded-full"></span>
            </div>

            <FlipDigit value={secs[0]} animate={isRunning && !isPaused} />
            <FlipDigit value={secs[1]} animate={isRunning && !isPaused} />
          </div>

          {/* Hover / tap-revealed controls */}
          <div
            aria-hidden={!showControls && !isPaused}
            className={`absolute bottom-20 sm:bottom-24 flex items-center gap-3 sm:gap-4 transition-all duration-300 ${
              showControls || isPaused ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
            }`}
          >
            <button
              onClick={handlePauseToggle}
              disabled={!isRunning}
              title={isPaused ? t("tm_resume") : t("tm_pause")}
              className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full border border-border/40 bg-card/90 backdrop-blur text-foreground shadow-md hover:bg-accent hover:border-border/70 transition disabled:opacity-30"
            >
              {isPaused ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
              )}
            </button>
            <button
              onClick={handleRestart}
              disabled={!isRunning}
              title={t("tm_restart")}
              className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full border border-border/40 bg-card/90 backdrop-blur text-foreground shadow-md hover:bg-accent hover:border-border/70 transition disabled:opacity-30"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
            </button>
            <button
              onClick={handleStop}
              disabled={!isRunning || isStopping}
              title={t("tm_stop")}
              className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full border border-border/40 bg-card/90 backdrop-blur text-foreground shadow-md hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition disabled:opacity-30"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
            </button>
          </div>

          <div className="absolute bottom-6 sm:bottom-10 text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
            <span className="hidden sm:inline">
              {t("tm_esc_to_exit", { key: "" }).split("{key}")[0]}<span className="text-foreground bg-card px-2 py-1 rounded border border-border/40">ESC</span>{t("tm_esc_to_exit", { key: "" }).split("{key}")[1]}
            </span>
            <span className="sm:hidden">{t("tm_tap_to_reveal")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <p className="whitespace-normal break-words font-mono text-[9px] uppercase leading-snug tracking-[0.16em] text-muted-foreground sm:tracking-[0.24em]">{label}</p>
      <p className="mt-1.5 break-words font-serif text-lg text-foreground tabular-nums">{value}</p>
    </div>
  );
}
