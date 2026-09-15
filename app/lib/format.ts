export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const moneyExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
