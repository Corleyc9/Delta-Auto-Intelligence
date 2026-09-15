export const BRAND_LOGO_SRC = "/brand/delta-auto-logo.png";
export const BRAND_LOGO_ALT = "Delta Auto — We keep you moving!";

export default function BrandLogo({
  variant = "header",
}: {
  variant?: "header" | "login";
}) {
  return (
    <img
      className={`brand-logo brand-logo-${variant}`}
      src={BRAND_LOGO_SRC}
      alt={BRAND_LOGO_ALT}
      width={1200}
      height={507}
      decoding="async"
    />
  );
}
