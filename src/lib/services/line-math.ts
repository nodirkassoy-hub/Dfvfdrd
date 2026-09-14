/**
 * Document line mathematics.
 *
 * All document totals (invoices, bills) are derived from their lines with
 * integer arithmetic, and the journal entry that is posted uses those exact
 * numbers. This is why a document total always equals the ledger amount.
 */
import { roundTo, decimalsFor } from "@/lib/money";

export type LineInput = {
  productId?: number | null;
  description: string;
  qtyMilli: number; // quantity × 1000
  unitPrice: number; // minor units per unit
  discount?: number; // minor units, absolute
  taxRateBp?: number; // basis points (1200 = 12%)
  accountId?: number | null;
  warehouseId?: number | null;
  taxCodeId?: number | null;
};

export type ComputedLine = LineInput & {
  netAmount: number;
  taxAmount: number;
  lineTotal: number;
};

export type ComputedDocument = {
  lines: ComputedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
};

/**
 * Line net = qty × unit price − discount, computed on integer minor units.
 * Tax is applied on the net per line and rounded once, so the sum of line
 * totals equals the document total to the minor unit.
 */
export function computeDocument(lines: LineInput[], currency = "UZS"): ComputedDocument {
  const decimals = decimalsFor(currency);
  const factor = Math.pow(10, decimals);

  const computed = lines.map<ComputedLine>((line) => {
    const qty = line.qtyMilli / 1000;
    const gross = roundTo(qty * (line.unitPrice / factor), decimals) * factor;
    const discount = Math.max(0, Math.round(line.discount ?? 0));
    const netAmount = Math.round(Math.max(0, gross - discount));
    const taxAmount = Math.round((netAmount * (line.taxRateBp ?? 0)) / 10_000);
    return { ...line, discount, netAmount, taxAmount, lineTotal: netAmount + taxAmount };
  });

  return {
    lines: computed,
    subtotal: computed.reduce((sum, line) => sum + line.netAmount, 0),
    discountTotal: computed.reduce((sum, line) => sum + (line.discount ?? 0), 0),
    taxTotal: computed.reduce((sum, line) => sum + line.taxAmount, 0),
    total: computed.reduce((sum, line) => sum + line.lineTotal, 0),
  };
}

export function qtyFromMilli(qtyMilli: number): number {
  return qtyMilli / 1000;
}

export function qtyToMilli(quantity: number): number {
  return Math.round(quantity * 1000);
}

export function documentStatusFromPayments(total: number, paid: number, dueDate: string, today: string, sent: boolean): string {
  if (paid <= 0) {
    if (!sent) return "draft";
    return dueDate < today ? "overdue" : "sent";
  }
  if (paid >= total) return "paid";
  return dueDate < today ? "overdue" : "partially_paid";
}
