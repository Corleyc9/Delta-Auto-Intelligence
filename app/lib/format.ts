export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const moneyExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const deltaSeconds = Math.round((Date.now() - then) / 1000);
  if (deltaSeconds < 45) return "just now";
  if (deltaSeconds < 90) return "1 min ago";
  if (deltaSeconds < 3600) return `${Math.round(deltaSeconds / 60)} min ago`;
  if (deltaSeconds < 5400) return "1 hr ago";
  if (deltaSeconds < 86400) return `${Math.round(deltaSeconds / 3600)} hr ago`;
  return new Date(value).toLocaleString();
}
