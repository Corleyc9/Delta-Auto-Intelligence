export type TechPayPlan = {
  thresholds: number[];
  rates: number[];
  baseHourlyRate: number;
  guaranteedHours?: number;
  guaranteedPay?: number;
  warning?: string;
};

export const TECH_PAY_PLANS: Record<string, TechPayPlan> = {
  "Stacy Williams": { thresholds: [30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60], rates: [45,45.5,46,46.75,47.5,48.25,49.25,50.25,51.25,52.25,53.25,54.25,55.25,56.25,57.25,58.25], baseHourlyRate: 45, guaranteedPay: 1800 },
  "MIKE COOK": { thresholds: [26,30,32,34,36,38,40,42,44,46,48,50,52], rates: [31,31.5,32,32.5,33,33.75,34.5,35.25,36.25,37.25,38.25,39.25,40.25], baseHourlyRate: 31, guaranteedHours: 26 },
  "Beau Corley": { thresholds: [26,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60], rates: [28,28.5,29,29.5,30.25,31,31.75,32.75,33.75,34.75,35.75,36.75,37.75,38.75,39.75,40.75,41.75], baseHourlyRate: 28, guaranteedHours: 26 },
  "Mario Butler": { thresholds: [26,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60], rates: [20,20.5,21,21.5,22.25,23,23.75,24.75,25.75,26.75,27.75,28.75,29.75,30.75,31.75,32.75,33.75], baseHourlyRate: 20, guaranteedHours: 26 },
};

export const MANAGER_BRACKETS = [
  { minimum: 0, rate: 0 }, { minimum: 18000, rate: .005 }, { minimum: 20000, rate: .01 },
  { minimum: 25000, rate: .015 }, { minimum: 30000, rate: .02 }, { minimum: 35000, rate: .025 },
  { minimum: 40000, rate: .03 },
];

export function tierForHours(plan: TechPayPlan, hours: number): number {
  let index = 0;
  plan.thresholds.forEach((threshold, candidate) => { if (hours >= threshold) index = candidate; });
  return index;
}
