import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Component as Globe } from "@/components/ui/interactive-globe";
import { cn } from "@/lib/utils";

interface ScrollGlobeProps {
  sections: {
    id: string;
    badge?: string;
    title: string;
    subtitle?: string;
    description: string;
    align?: "left" | "center" | "right";
    features?: { title: string; description: string; image?: string }[];
    actions?: { label: string; variant: "primary" | "secondary"; onClick?: () => void }[];
    screenshots?: { src?: string; alt: string; caption?: string }[];
  }[];
  globeConfig?: {
    positions: { top: string; left: string; scale: number }[];
  };
  className?: string;
}

const defaultGlobeConfig = {
  positions: [
    { top: "50%", left: "75%", scale: 1.4 },
    { top: "25%", left: "50%", scale: 0.9 },
    { top: "15%", left: "90%", scale: 2 },
    { top: "50%", left: "50%", scale: 1.8 },
  ],
};

const parsePercent = (str: string): number => parseFloat(str.replace("%", ""));

export function ScrollGlobe({ sections, globeConfig = defaultGlobeConfig, className }: ScrollGlobeProps) {
  const [activeSection, setActiveSection] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [globeTransform, setGlobeTransform] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const animationFrameId = useRef<number>();

  const calculatedPositions = useMemo(
    () =>
      globeConfig.positions.map((pos) => ({
        top: parsePercent(pos.top),
        left: parsePercent(pos.left),
        scale: pos.scale,
      })),
    [globeConfig.positions],
  );

  const updateScrollPosition = useCallback(() => {
    const scrollTop = window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = Math.min(Math.max(scrollTop / docHeight, 0), 1);
    setScrollProgress(progress);

    const viewportCenter = window.innerHeight / 2;
    let newActiveSection = 0;
    let minDistance = Infinity;

    sectionRefs.current.forEach((ref, index) => {
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height / 2;
      const distance = Math.abs(sectionCenter - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        newActiveSection = index;
      }
    });

    const currentPos = calculatedPositions[newActiveSection] || calculatedPositions[0];
    setGlobeTransform(
      `translate3d(${currentPos.left}vw, ${currentPos.top}vh, 0) translate3d(-50%, -50%, 0) scale3d(${currentPos.scale}, ${currentPos.scale}, 1)`,
    );
    setActiveSection(newActiveSection);
  }, [calculatedPositions]);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        animationFrameId.current = requestAnimationFrame(() => {
          updateScrollPosition();
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    updateScrollPosition();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [updateScrollPosition]);

  useEffect(() => {
    const initialPos = calculatedPositions[0];
    setGlobeTransform(
      `translate3d(${initialPos.left}vw, ${initialPos.top}vh, 0) translate3d(-50%, -50%, 0) scale3d(${initialPos.scale}, ${initialPos.scale}, 1)`,
    );
  }, [calculatedPositions]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full max-w-screen overflow-x-hidden min-h-screen bg-background text-foreground",
        className,
      )}
    >
      {/* Progress bar */}
      <div className="fixed top-0 left-0 w-full h-0.5 bg-white/10 z-50">
        <div
          className="h-full bg-white"
          style={{
            transform: `scaleX(${scrollProgress})`,
            transformOrigin: "left center",
            transition: "transform 0.15s ease-out",
          }}
        />
      </div>

      {/* Side nav dots */}
      <div className="hidden sm:flex fixed right-4 lg:right-8 top-1/2 -translate-y-1/2 z-40">
        <div className="space-y-4 lg:space-y-6">
          {sections.map((section, index) => (
            <button
              key={section.id}
              onClick={() => sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className={cn(
                "block w-2.5 h-2.5 rounded-full border transition-all duration-300 hover:scale-125",
                activeSection === index
                  ? "bg-white border-white"
                  : "bg-transparent border-white/30 hover:border-white/70",
              )}
              aria-label={`Go to ${section.badge || `section ${index + 1}`}`}
            />
          ))}
        </div>
      </div>

      {/* Globe */}
      <div
        className="fixed z-10 pointer-events-none will-change-transform transition-all duration-[1400ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
        style={{
          transform: globeTransform,
          filter: `opacity(${activeSection === sections.length - 1 ? 0.4 : 0.85})`,
        }}
      >
        <div className="scale-75 sm:scale-90 lg:scale-100">
          <Globe />
        </div>
      </div>

      {/* Sections */}
      {sections.map((section, index) => (
        <section
          key={section.id}
          ref={(el) => (sectionRefs.current[index] = el)}
          className={cn(
            "relative min-h-screen flex flex-col justify-center px-4 sm:px-6 md:px-8 lg:px-12 z-20 py-16 lg:py-20 w-full max-w-full overflow-hidden",
            section.align === "center" && "items-center text-center",
            section.align === "right" && "items-end text-right",
            section.align !== "center" && section.align !== "right" && "items-start text-left",
          )}
        >
          <div className="w-full max-w-sm sm:max-w-lg md:max-w-2xl lg:max-w-4xl xl:max-w-5xl">
            {section.badge && <p className="label-caps mb-4">{section.badge}</p>}
            {(() => {
              const Heading = (index === 0 ? "h1" : "h2") as "h1" | "h2";
              return (
                <Heading
                  className={cn(
                    "font-serif mb-6 sm:mb-8 leading-[1.05] tracking-tight",
                    index === 0
                      ? "text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl"
                      : "text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl",
                  )}
                >
                  {section.subtitle ? (
                    <span className="space-y-2 block">
                      <span className="block">{section.title}</span>
                      <span className="block text-white/60 text-[0.6em] tracking-wider italic">
                        {section.subtitle}
                      </span>
                    </span>
                  ) : (
                    <span>{section.title}</span>
                  )}
                </Heading>
              );
            })()}

            <p
              className={cn(
                "text-white/70 leading-relaxed mb-8 text-base sm:text-lg lg:text-xl font-light",
                section.align === "center" ? "max-w-2xl mx-auto" : "max-w-2xl",
              )}
            >
              {section.description}
            </p>

            {section.features && (
              <div className="grid gap-3 mb-8">
                {section.features.map((feature) => (
                  <div
                    key={feature.title}
                    className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm p-3 sm:p-4"
                  >
                    <h3 className="font-serif text-lg sm:text-xl mb-2">{feature.title}</h3>
                    <p className="text-white/60 text-sm sm:text-base leading-relaxed">{feature.description}</p>
                    {feature.image && (
                      <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-black/20">
                        <img
                          src={feature.image}
                          alt={feature.title}
                          loading="lazy"
                          className="block w-full h-auto object-contain"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {section.screenshots && section.screenshots.length > 0 && (
              <div
                className={cn(
                  "grid gap-5 sm:gap-6 mb-10",
                  section.screenshots.length === 1
                    ? "grid-cols-1 max-w-3xl"
                    : section.screenshots.length === 2
                      ? "grid-cols-1 md:grid-cols-2"
                      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
                  section.align === "center" && "mx-auto",
                )}
              >
                {section.screenshots.map((shot, i) => (
                  <figure
                    key={i}
                    className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm hover:border-white/20 hover:bg-white/[0.04] transition-all"
                  >
                    <div className="w-full overflow-hidden bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent">
                      {shot.src ? (
                        <img
                          src={shot.src}
                          alt={shot.alt}
                          loading="lazy"
                          className="block h-auto w-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="flex aspect-[4/3] w-full items-center justify-center text-white/30 text-xs uppercase tracking-[0.2em]">
                          {shot.alt}
                        </div>
                      )}
                    </div>
                    {shot.caption && (
                      <figcaption className="px-4 py-3 text-xs text-white/50 border-t border-white/5">
                        {shot.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}

            {section.actions && (
              <div
                className={cn(
                  "flex flex-col sm:flex-row flex-wrap gap-3",
                  section.align === "center" && "justify-center",
                  section.align === "right" && "justify-end",
                )}
              >
                {section.actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onClick}
                    className={action.variant === "primary" ? "btn-primary" : "btn-secondary"}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export default ScrollGlobe;
