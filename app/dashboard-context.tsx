"use client";

import { createContext, useContext } from "react";

export const DashboardContext = createContext<any>(null);

export function useDashboard() {
  return useContext(DashboardContext);
}
