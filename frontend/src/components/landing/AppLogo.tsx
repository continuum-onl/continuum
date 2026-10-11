import { forwardRef } from "react";

interface AppLogoProps {
  className?: string;
}

const AppLogo = forwardRef<HTMLImageElement, AppLogoProps>(({ className = "w-7 h-7" }, ref) => {
  return (
    <img
      ref={ref}
      src="/icon-transparent.png"
      alt="Continuum"
      className={`${className} object-contain`}
      aria-hidden="true"
    />
  );
});

AppLogo.displayName = "AppLogo";

export default AppLogo;
