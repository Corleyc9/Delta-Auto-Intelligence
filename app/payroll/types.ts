export type PayrollInputs = {
  techs: Record<string, { tierOverride: number | null; holiday: number; reimbursement: number; other: number; notes: string }>;
  writers: {
    commissionRatePercent: number; miscDeduction: number;
    kody: { baseSalary: number; splitPercent: number };
    andrea: { baseSalary: number; splitPercent: number };
  };
  manager: { name: string; profitSales: number; sublet: number; laborProfit?: number; partsProfit?: number; subletProfit?: number; feesProfit?: number };
  towing: Record<string, { jobTotal: number; nightBonus: number; weekdayBonus: number }>;
};

export const emptyPayrollInputs = (): PayrollInputs => ({
  techs: {},
  writers: { commissionRatePercent: 8, miscDeduction: 0, kody: { baseSalary: 1000, splitPercent: 70 }, andrea: { baseSalary: 0, splitPercent: 30 } },
  manager: { name: "", profitSales: 0, sublet: 0 },
  towing: { Josh: { jobTotal: 0, nightBonus: 0, weekdayBonus: 0 }, Zoe: { jobTotal: 0, nightBonus: 0, weekdayBonus: 0 } },
});
