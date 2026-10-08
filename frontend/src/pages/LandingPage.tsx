/*
 * CONTINUUM — Landing Page
 * Powered by the ScrollGlobe scroll-driven story.
 * Copy is localized automatically from the visitor's browser language.
 * File size: ~4.5 KB
 */
import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import AuthDialog from "@/components/auth/AuthDialog";
import PwaInstallListener from "@/components/pwa/PwaInstallListener";
import { ScrollGlobe } from "@/components/ui/landing-page";
import { useLanguage } from "@/contexts/LanguageContext";
import landingEditor from "@/assets/landing-editor.png";
import landingGraph from "@/assets/landing-graph.jpg";
import landingInsights from "@/assets/landing-insights.jpg";

const SITE_URL = "https://continuum.onl/";

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const { t, language } = useLanguage();

  const openAuth = () => setAuthOpen(true);

  const faqs = useMemo(
    () => [
      { q: t("lp_faq_q1"), a: t("lp_faq_a1") },
      { q: t("lp_faq_q2"), a: t("lp_faq_a2") },
      { q: t("lp_faq_q3"), a: t("lp_faq_a3") },
      { q: t("lp_faq_q4"), a: t("lp_faq_a4") },
      { q: t("lp_faq_q5"), a: t("lp_faq_a5") },
    ],
    [t],
  );

  // Localized head metadata + FAQ structured data for search engines.
  useEffect(() => {
    document.title = t("lp_metaTitle");

    const setMeta = (attr: "name" | "property", key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("name", "description", t("lp_metaDescription"));
    setMeta("property", "og:title", t("lp_metaTitle"));
    setMeta("property", "og:description", t("lp_metaDescription"));
    setMeta("property", "og:locale", language === "en" ? "en_US" : language === "pt" ? "pt_BR" : language === "es" ? "es_ES" : "fr_FR");
    setMeta("name", "twitter:title", t("lp_metaTitle"));
    setMeta("name", "twitter:description", t("lp_metaDescription"));

    const id = "continuum-faq-jsonld";
    document.getElementById(id)?.remove();
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: language,
      url: SITE_URL,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById(id)?.remove();
    };
  }, [t, language, faqs]);

  const sections = [
    {
      id: "hero",
      badge: t("lp_hero_badge"),
      title: t("lp_hero_title"),
      subtitle: t("lp_hero_subtitle"),
      description: t("lp_hero_description"),
      align: "left" as const,
      actions: [
        { label: t("lp_hero_cta"), variant: "primary" as const, onClick: () => openAuth() },
      ],
    },
    {
      id: "connect",
      badge: t("lp_connect_badge"),
      title: t("lp_connect_title"),
      description: t("lp_connect_description"),
      align: "center" as const,
      screenshots: [
        { src: landingEditor, alt: t("lp_connect_shot2_alt"), caption: t("lp_connect_shot2_caption") },
      ],
    },
    {
      id: "discover",
      badge: t("lp_discover_badge"),
      title: t("lp_discover_title"),
      subtitle: t("lp_discover_subtitle"),
      description: t("lp_discover_description"),
      align: "left" as const,
      features: [
        { title: t("lp_discover_f1_title"), description: t("lp_discover_f1_desc"), image: landingInsights },
        { title: t("lp_discover_f2_title"), description: t("lp_discover_f2_desc") },
        { title: t("lp_discover_f3_title"), description: t("lp_discover_f3_desc") },
      ],
      screenshots: [
        { src: landingGraph, alt: t("lp_discover_shot1_alt"), caption: t("lp_discover_shot1_caption") },
      ],
    },
    {
      id: "future",
      badge: t("lp_future_badge"),
      title: t("lp_future_title"),
      subtitle: t("lp_future_subtitle"),
      description: t("lp_future_description"),
      align: "center" as const,
      actions: [
        { label: t("lp_hero_cta"), variant: "primary" as const, onClick: () => openAuth() },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Navbar onAuthOpen={() => openAuth()} />
      <main>
        <ScrollGlobe sections={sections} className="bg-black" />

        {/* FAQ — keyword-rich, crawlable content */}
        <section id="faq" className="relative border-t border-white/[0.06] py-20 lg:py-28">
          <div className="container relative z-10 max-w-3xl lg:mx-0 lg:pl-8 xl:pl-12">
            <p className="label-caps mb-4 text-[#888888]">{t("lp_faq_label")}</p>
            <h2
              className="font-serif text-3xl sm:text-4xl lg:text-5xl leading-tight tracking-tight mb-10"
            >
              {t("lp_faq_title")}
            </h2>
            <dl className="space-y-8">
              {faqs.map((f) => (
                <div key={f.q} className="border-t border-white/[0.06] pt-6">
                  <dt className="font-body text-base sm:text-lg text-white mb-2">{f.q}</dt>
                  <dd className="font-body text-sm sm:text-base leading-[1.75] text-[#888888]">
                    {f.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <Footer />
      <PwaInstallListener />
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} initialTab="login" />
    </div>
  );
}
