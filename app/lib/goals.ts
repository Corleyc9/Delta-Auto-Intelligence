export const WEEKLY_SALES_GOAL = 60000;
export const WEEKLY_HOURS_SOLD_GOAL = 175;
export const WEEKLY_CAR_GOAL = 60;
export const ARO_GOAL = 1000;
export const HOURS_PER_RO_GOAL = 3;
export const GP_TARGET_PERCENT = 60;
export const GP_ACCEPTABLE_PERCENT = 58;
export const WIP_GP_PER_HOUR_MINIMUM = 170;

export function technicianWeeklyTarget(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("devin")) return 0;
  if (lower.includes("stacy")) return 60;
  if (lower.includes("mario")) return 20;
  return 40;
}

export const SAMPLE_RANGE_DATA = {
  "This week": {
    label: "",
    comparison: "vs last Wednesday–Tuesday",
    sales: 86420,
    grossProfit: 42180,
    laborSales: 31760,
    salesChange: 12.4,
    gpChange: 9.7,
    laborChange: 8.3,
    techs: [
      { name: "Beau", hours: 42.8, target: 40 },
      { name: "Technician 2", hours: 37.4, target: 40 },
      { name: "Technician 3", hours: 31.6, target: 40 },
    ],
    trend: [9.6, 11.8, 13.9, 14.2, 15.7, 10.1, 17.6, 18.4],
  },
  "Last week": {
    label: "",
    comparison: "previous Wednesday–Tuesday",
    sales: 76890,
    grossProfit: 38450,
    laborSales: 29320,
    salesChange: 6.1,
    gpChange: 5.3,
    laborChange: 4.9,
    techs: [
      { name: "Beau", hours: 39.1, target: 40 },
      { name: "Technician 2", hours: 35.8, target: 40 },
      { name: "Technician 3", hours: 30.2, target: 40 },
    ],
    trend: [8.8, 10.4, 12.7, 11.9, 14.1, 9.4, 15.2, 16.1],
  },
  "This month": {
    label: "",
    comparison: "current calendar month",
    sales: 322870,
    grossProfit: 157640,
    laborSales: 119430,
    salesChange: 10.2,
    gpChange: 8.8,
    laborChange: 7.4,
    techs: [
      { name: "Beau", hours: 166.2, target: 160 },
      { name: "Technician 2", hours: 149.7, target: 160 },
      { name: "Technician 3", hours: 131.4, target: 160 },
    ],
    trend: [35.2, 39.8, 37.1, 43.6, 40.2, 45.8, 42.1, 39.1],
  },
} as const;
