import type { ReactNode } from "react";

export default function Icon({ children }: { children: ReactNode }) {
  return <span className="kpi-icon" aria-hidden="true">{children}</span>;
}
