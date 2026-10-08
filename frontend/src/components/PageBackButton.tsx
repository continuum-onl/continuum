import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "@/lib/heroicons";

export function PageBackButton() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <Button
      variant="quiet"
      size="sm"
      onClick={() => navigate(-1)}
      className="mb-6 h-auto px-0"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> {t("common_back")}
    </Button>
  );
}
