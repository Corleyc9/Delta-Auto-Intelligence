export function isEmptyJobBoard(repairOrders: unknown[]): boolean {
  return !Array.isArray(repairOrders) || repairOrders.length === 0;
}

export function isEmptyCriticalSnapshot(payload: {
  technicians?: unknown[];
  totalSales?: number;
  totalROs?: number;
}): boolean {
  const technicians = Array.isArray(payload.technicians) ? payload.technicians : [];
  const sales = Number(payload.totalSales) || 0;
  const ros = Number(payload.totalROs) || 0;
  return technicians.length === 0 && sales === 0 && ros === 0;
}

export function isEmptyListSnapshot(items: unknown[]): boolean {
  return !Array.isArray(items) || items.length === 0;
}
