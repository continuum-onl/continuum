/*
 * CONTINUUM — Footer
 * Design: Void Cartography — minimal, dark, clean grid
 */
import AppLogo from "./AppLogo";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();

  const columns = [
    {
      title: t("lp_footer_product"),
      links: [
        { label: t("lp_footer_pricing"), href: "/pricing" },
        { label: t("lp_footer_about"), href: "/about" },
        { label: t("lp_footer_opensource"), href: "https://github.com/continuum-onl/continuum" },
        { label: t("lp_footer_support"), href: "/support" },
        { label: "Versions", href: "/versions" },
      ],
    },

    {
      title: t("lp_footer_legal"),
      links: [
        { label: t("lp_footer_terms"), href: "/terms" },
        { label: t("lp_footer_privacy"), href: "/privacy" },
      ],
    },
    {
      title: t("lp_footer_contact"),
      links: [
        { label: "contact@continuum.onl", href: "mailto:contact@continuum.onl" },
        { label: "feedback@continuum.onl", href: "mailto:feedback@continuum.onl" },
      ],
    },
  ];

  return (
    <footer className="relative border-t border-white/[0.06] bg-black">
      {/* Background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 50% 100% at 50% 0%, rgba(255,255,255,0.02) 0%, transparent 60%)",
        }}
      />

      <div className="container relative z-10 py-14 lg:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div className="max-w-sm">
            <a href="/" className="flex items-center gap-2.5 mb-5">
              <AppLogo />
              <span
                className="text-white font-semibold tracking-tight text-[1.05rem]"
                style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700 }}
              >
                Continuum
              </span>
            </a>
            <p className="font-body text-sm leading-[1.75] text-[#888888]">
              {t("lp_footer_tagline")}
            </p>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/30">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="font-body text-sm text-[#888888] transition-colors hover:text-white"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-white/[0.05]">
          <p className="font-body text-xs text-[#888888]">
            © {new Date().getFullYear()} Continuum. {t("lp_footer_rights")}
          </p>
        </div>
      </div>
    </footer>
  );
}
