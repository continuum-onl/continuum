/*
 * CONTINUUM — HeroSection
 * Design: Void Cartography — asymmetric layout, Inter Bold headline
 * Left: headline + subheadline + CTAs | Right: animated knowledge graph
 * Background: near-black with subtle radial gradient + grid
 */
import { motion } from "framer-motion";
import { ArrowRight, Play } from "@/lib/heroicons";
import { Link } from "react-router-dom";
import KnowledgeGraph from "@/components/landing/KnowledgeGraph";

const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.65, ease: EASE, delay },
});

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background gradient layers */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(circle at 70% 40%, rgba(255, 255, 255, 0.06), transparent 30%),
            radial-gradient(circle at 15% 25%, rgba(255, 255, 255, 0.04), transparent 24%),
            radial-gradient(circle at 50% 100%, rgba(0, 0, 0, 0.95), transparent 60%)
          `,
        }}
      />

      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 0%, transparent 100%)",
        }}
      />

      <div className="container relative z-10 pt-24 pb-16 lg:pt-32 lg:pb-24">
        <div className="grid lg:grid-cols-[1fr_1fr] gap-12 lg:gap-8 items-center">
          {/* Left: Text content */}
          <div className="max-w-xl">

            {/* Headline */}
            <motion.h1
              {...fadeUp(0.2)}
              className="font-display text-[clamp(2.75rem,6vw,5rem)] font-bold leading-[1.05] tracking-[-0.025em] text-white mb-6"
            >
              Your personal journal,
              <br />
              <em className="not-italic text-[#888888] italic">without the friction.</em>
            </motion.h1>

            {/* Subheading Subheadline */}
            <motion.p
              {...fadeUp(0.3)}
              className="font-body text-[1.0625rem] leading-[1.75] text-[#888888] mb-10 max-w-md"
            >
              Capture your days, thoughts and memories in a personal journal with connected entries and native sync across devices.
            </motion.p>

            {/* CTAs */}
            <motion.div {...fadeUp(0.4)} className="flex flex-wrap gap-3">
              <Link to="/register" className="btn-primary animate-pulse-glow">
                Start for free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#how-it-works" className="btn-secondary">
                <Play className="w-3.5 h-3.5 opacity-70" />
                See how it works
              </a>
            </motion.div>
          </div>

          {/* Right: Knowledge Graph */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 1, ease: EASE, delay: 0.3 }}
            className="relative h-[420px] lg:h-[540px]"
          >
            {/* Outer glow ring */}
            <div
              className="absolute inset-4 rounded-2xl pointer-events-none"
              style={{
                background: "radial-gradient(ellipse 80% 80% at 50% 50%, rgba(255,255,255,0.12) 0%, transparent 70%)",
                filter: "blur(20px)",
              }}
            />
              <KnowledgeGraph className="relative z-10" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
