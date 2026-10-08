import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import AppLogo from "@/components/landing/AppLogo";

const NotFound = () => {
  const { t } = useLanguage();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-[#f3f1eb]">
      <div className="flex max-w-2xl flex-col items-center text-center">
        <div className="mb-11 flex items-center gap-2.5">
          <AppLogo className="h-7 w-7" />
          <span className="font-sans text-xl font-semibold tracking-tight">Continuum</span>
        </div>

        <h1 className="mb-2 font-sans text-2xl font-semibold tracking-tight sm:text-[26px]">
          {t("au_404_title")}
        </h1>

        <p className="mb-6 text-sm leading-6 text-[#bcbab4] sm:text-[15px]">
          {t("au_404_desc")}
        </p>

        <Link
          to="/"
          className="rounded-lg bg-[#f3f1eb] px-4 py-2 text-sm font-medium text-[#141414] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3f1eb] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {t("au_return_home")}
        </Link>
      </div>
    </main>
  );
};

export default NotFound;
