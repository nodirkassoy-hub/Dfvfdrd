/**
 * Inventory service — moving-average cost valuation.
 *
 * Stock in  (purchases) : the bill/expense entry already debits Inventory, so
 *                         the move is recorded without a second entry.
 * Stock out (sales)     : a dedicated entry Dr Cost of goods sold / Cr Inventory
 *                         at the moving-average cost keeps gross profit correct.
 * Adjustments           : valued at moving-average cost against the inventory
 *                         write-off account.
 */
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { ValidationError } from "@/lib/accounting/errors";
import { SYSTEM_ACCOUNTS } from "@/lib/accounting/coa";
import { accountIdByCodeOrThrow, postEntryTx } from "@/lib/accounting/engine";
import { recordAudit } from "./company";
import { todayISO } from "@/lib/dates";

export type Ctx = { userId?: number | null; userName?: string | null };

export type StockBalance = {
  productId: number;
  warehouseId: number;
  warehouseName: string;
  qtyMilli: number;
  value: number;
  avgCost: number;
};

export function stockBalances(companyId: number, productId?: number): StockBalance[] {
  const params: unknown[] = [companyId];
  let filter = "";
  if (productId) {
    filter = " AND b.product_id = ?";
    params.push(productId);
  }
  return all<StockBalance>(
    `SELECT b.product_id AS productId, b.warehouse_id AS warehouseId, w.name AS warehouseName,
            b.qty_milli AS qtyMilli, b.value AS value,
            CASE WHEN b.qty_milli <> 0 THEN CAST(ROUND(CAST(b.value AS REAL) * 1000 / b.qty_milli) AS INTEGER) ELSE 0 END AS avgCost
       FROM v_stock_balances b
       JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.company_id = ?${filter}
      ORDER BY w.name`,
    params,
  );
}

export function productStock(companyId: number, productId: number): { qtyMilli: number; value: number; avgCost: number } {
  const row = one<{ qty: number; value: number }>(
    `SELECT COALESCE(SUM(qty_milli),0) AS qty, COALESCE(SUM(value),0) AS value
       FROM v_stock_balances WHERE company_id = ? AND product_id = ?`,
    [companyId, productId],
  );
  const qtyMilli = row?.qty ?? 0;
  const value = row?.value ?? 0;
  return { qtyMilli, value, avgCost: qtyMilli !== 0 ? Math.round((value * 1000) / qtyMilli) : 0 };
}

export function inventoryValue(companyId: number): { qtyMilli: number; value: number; products: number } {
  const row = one<{ qty: number; value: number; products: number }>(
    `SELECT COALESCE(SUM(qty_milli),0) AS qty, COALESCE(SUM(value),0) AS value, COUNT(DISTINCT product_id) AS products
       FROM v_stock_balances WHERE company_id = ?`,
    [companyId],
  );
  return { qtyMilli: row?.qty ?? 0, value: row?.value ?? 0, products: row?.products ?? 0 };
}

export function lowStockProducts(companyId: number) {
  return all<{
    id: number;
    sku: string;
    name: string;
    minStockMilli: number;
    qtyMilli: number;
    unit: string;
  }>(
    `SELECT * FROM (
       SELECT p.id AS id, p.sku AS sku, p.name AS name, p.min_stock_milli AS minStockMilli, p.unit AS unit,
              COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS qtyMilli
         FROM products p
        WHERE p.company_id = ? AND p.is_archived = 0 AND p.is_tracked = 1 AND p.min_stock_milli > 0
     ) WHERE qtyMilli <= minStockMilli
      ORDER BY (CAST(qtyMilli AS REAL) / NULLIF(minStockMilli, 0)) ASC`,
    [companyId],
  );
}

export type StockMoveInput = {
  companyId: number;
  productId: number;
  warehouseId: number;
  date: string;
  direction: "in" | "out" | "transfer_in" | "transfer_out" | "adjust_in" | "adjust_out";
  qtyMilli: number;
  unitCost: number;
  refType?: string;
  refId?: number | null;
  transferGroup?: string | null;
  note?: string | null;
  ctx?: Ctx;
};

export function recordStockMove(input: StockMoveInput): number {
  const qty = Math.abs(Math.round(input.qtyMilli));
  if (qty === 0) throw new ValidationError("QTY_ZERO", "Quantity must be greater than zero");
  const value = Math.round((qty * input.unitCost) / 1000);
  return insert(
    `INSERT INTO stock_moves
      (company_id, product_id, warehouse_id, date, direction, qty_milli, unit_cost, value, ref_type, ref_id,
       transfer_group, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.companyId,
      input.productId,
      input.warehouseId,
      input.date,
      input.direction,
      qty,
      input.unitCost,
      value,
      input.refType ?? null,
      input.refId ?? null,
      input.transferGroup ?? null,
      input.note ?? null,
      input.ctx?.userId ?? null,
      nowISO(),
    ],
  );
}

/**
 * Called after a sales invoice is posted: issues tracked products and books the
 * cost of goods sold at moving-average cost in one balanced entry.
 */
export function consumeStockForDocument(params: {
  companyId: number;
  documentType: "invoice";
  documentId: number;
  date: string;
  warehouseId: number | null;
  currency: string;
  fxRateMicro: number;
  ctx: Ctx;
  bypassPeriodLock?: boolean;
}): { entryId: number | null; cost: number } {
  return tx(() => {
    const lines = all<{
      product_id: number | null;
      qty_milli: number;
      warehouse_id: number | null;
      description: string;
    }>(
      `SELECT il.product_id, il.qty_milli, il.warehouse_id, il.description
         FROM invoice_lines il JOIN products p ON p.id = il.product_id
        WHERE il.invoice_id = ? AND p.is_tracked = 1`,
      [params.documentId],
    );
    if (!lines.length) return { entryId: null, cost: 0 };

    const defaultWarehouse = one<{ id: number }>("SELECT id FROM warehouses WHERE company_id = ? ORDER BY is_default DESC, id LIMIT 1", [
      params.companyId,
    ]);

    let totalCost = 0;
    const moveIds: number[] = [];
    for (const line of lines) {
      if (!line.product_id) continue;
      const warehouseId = line.warehouse_id ?? params.warehouseId ?? defaultWarehouse?.id;
      if (!warehouseId) throw new ValidationError("NO_WAREHOUSE", "Create a warehouse before selling tracked goods");
      const stock = productStock(params.companyId, line.product_id);
      const unitCost = stock.avgCost;
      const moveId = recordStockMove({
        companyId: params.companyId,
        productId: line.product_id,
        warehouseId,
        date: params.date,
        direction: "out",
        qtyMilli: line.qty_milli,
        unitCost,
        refType: "invoice",
        refId: params.documentId,
        ctx: params.ctx,
      });
      moveIds.push(moveId);
      totalCost += Math.round((line.qty_milli * unitCost) / 1000);
    }

    if (totalCost <= 0) return { entryId: null, cost: 0 };

    const entry = postEntryTx({
      companyId: params.companyId,
      date: params.date,
      memo: `Cost of goods sold — invoice #${params.documentId}`,
      sourceType: "stock",
      sourceId: params.documentId,
      userId: params.ctx.userId ?? null,
      bypassPeriodLock: params.bypassPeriodLock,
      lines: [
        {
          accountId: accountIdByCodeOrThrow(params.companyId, SYSTEM_ACCOUNTS.COGS_GOODS),
          debit: totalCost,
          description: "Cost of goods sold",
          docType: "invoice",
          docId: params.documentId,
        },
        {
          accountId: accountIdByCodeOrThrow(params.companyId, SYSTEM_ACCOUNTS.INVENTORY),
          credit: totalCost,
          description: "Inventory issued",
          docType: "invoice",
          docId: params.documentId,
        },
      ],
    });

    return { entryId: entry.id, cost: totalCost };
  });
}

export function adjustStock(
  input: {
    companyId: number;
    productId: number;
    warehouseId: number;
    date: string;
    qtyMilli: number; // signed: positive increases stock
    note?: string;
  },
  ctx: Ctx = {},
): { entryId: number | null } {
  return tx(() => {
    if (!input.qtyMilli) throw new ValidationError("QTY_ZERO", "Adjustment quantity must not be zero");
    const stock = productStock(input.companyId, input.productId);
    const unitCost = stock.avgCost;
    const direction = input.qtyMilli > 0 ? "adjust_in" : "adjust_out";
    recordStockMove({
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      date: input.date,
      direction,
      qtyMilli: input.qtyMilli,
      unitCost,
      refType: "adjustment",
      note: input.note ?? null,
      ctx,
    });

    const value = Math.round((Math.abs(input.qtyMilli) * unitCost) / 1000);
    if (value <= 0) return { entryId: null };

    const inventory = accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.INVENTORY);
    const writeOff = accountIdByCodeOrThrow(input.companyId, "6130");
    const entry = postEntryTx({
      companyId: input.companyId,
      date: input.date,
      memo: input.note ?? "Inventory adjustment",
      sourceType: "stock",
      userId: ctx.userId ?? null,
      lines:
        input.qtyMilli > 0
          ? [
              { accountId: inventory, debit: value, description: "Inventory increase" },
              { accountId: writeOff, credit: value, description: "Inventory adjustment gain" },
            ]
          : [
              { accountId: writeOff, debit: value, description: "Inventory write-off" },
              { accountId: inventory, credit: value, description: "Inventory decrease" },
            ],
    });
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "adjust",
      entityType: "stock",
      entityId: input.productId,
      summary: `Stock adjustment ${input.qtyMilli > 0 ? "+" : ""}${input.qtyMilli / 1000} units`,
      after: { value, entryId: entry.id },
    });
    return { entryId: entry.id };
  });
}

export function transferStock(
  input: {
    companyId: number;
    productId: number;
    fromWarehouseId: number;
    toWarehouseId: number;
    date: string;
    qtyMilli: number;
    note?: string;
  },
  ctx: Ctx = {},
): void {
  return tx(() => {
    if (input.fromWarehouseId === input.toWarehouseId) throw new ValidationError("SAME_WAREHOUSE", "Source and destination warehouses must differ");
    const qty = Math.abs(Math.round(input.qtyMilli));
    if (!qty) throw new ValidationError("QTY_ZERO", "Quantity must be greater than zero");
    const stock = productStock(input.companyId, input.productId);
    const unitCost = stock.avgCost;
    const group = `TR-${Date.now()}`;
    recordStockMove({
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      date: input.date,
      direction: "transfer_out",
      qtyMilli: qty,
      unitCost,
      refType: "transfer",
      transferGroup: group,
      note: input.note ?? null,
      ctx,
    });
    recordStockMove({
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      date: input.date,
      direction: "transfer_in",
      qtyMilli: qty,
      unitCost,
      refType: "transfer",
      transferGroup: group,
      note: input.note ?? null,
      ctx,
    });
  });
}

export function stockMoveHistory(
  companyId: number,
  filters: { productId?: number; warehouseId?: number; from?: string; to?: string; limit?: number } = {},
) {
  const conditions = ["m.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.productId) {
    conditions.push("m.product_id = ?");
    params.push(filters.productId);
  }
  if (filters.warehouseId) {
    conditions.push("m.warehouse_id = ?");
    params.push(filters.warehouseId);
  }
  if (filters.from) {
    conditions.push("m.date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("m.date <= ?");
    params.push(filters.to);
  }
  params.push(filters.limit ?? 200);
  return all<{
    id: number;
    date: string;
    productName: string;
    sku: string;
    warehouseName: string;
    direction: string;
    qtyMilli: number;
    unitCost: number;
    value: number;
    refType: string | null;
    refId: number | null;
    note: string | null;
    userName: string | null;
  }>(
    `SELECT m.id, m.date, p.name AS productName, p.sku, w.name AS warehouseName, m.direction, m.qty_milli AS qtyMilli,
            m.unit_cost AS unitCost, m.value, m.ref_type AS refType, m.ref_id AS refId, m.note, u.name AS userName
       FROM stock_moves m
       JOIN products p ON p.id = m.product_id
       JOIN warehouses w ON w.id = m.warehouse_id
       LEFT JOIN users u ON u.id = m.created_by
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.date DESC, m.id DESC
      LIMIT ?`,
    params,
  );
}

export function inventoryReport(companyId: number) {
  return all<{
    id: number;
    sku: string;
    name: string;
    unit: string;
    qtyMilli: number;
    value: number;
    avgCost: number;
    purchasePrice: number;
    sellingPrice: number;
    minStockMilli: number;
    isLow: number;
  }>(
    `SELECT p.id, p.sku, p.name, p.unit,
            COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS qtyMilli,
            COALESCE((SELECT SUM(value) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS value,
            CASE WHEN COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) <> 0
                 THEN CAST(ROUND(COALESCE((SELECT SUM(value) FROM v_stock_balances b WHERE b.product_id = p.id), 0) * 1000.0 /
                      (SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id)) AS INTEGER)
                 ELSE 0 END AS avgCost,
            p.purchase_price AS purchasePrice, p.selling_price AS sellingPrice, p.min_stock_milli AS minStockMilli,
            CASE WHEN p.min_stock_milli > 0 AND
                 COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) <= p.min_stock_milli
                 THEN 1 ELSE 0 END AS isLow
       FROM products p
      WHERE p.company_id = ? AND p.is_archived = 0
      ORDER BY p.name`,
    [companyId],
  );
}

export function setProductSkuSequence(companyId: number): string {
  const count = one<{ count: number }>("SELECT COUNT(*) AS count FROM products WHERE company_id = ?", [companyId]);
  return `SKU-${String((count?.count ?? 0) + 1).padStart(4, "0")}`;
}

export function deleteProduct(companyId: number, productId: number, ctx: Ctx = {}): void {
  const used = one<{ count: number }>(
    `SELECT (SELECT COUNT(*) FROM invoice_lines WHERE product_id = ?) +
            (SELECT COUNT(*) FROM bill_lines WHERE product_id = ?) +
            (SELECT COUNT(*) FROM stock_moves WHERE product_id = ?) AS count`,
    [productId, productId, productId],
  );
  if ((used?.count ?? 0) > 0) {
    run("UPDATE products SET is_archived = 1 WHERE id = ? AND company_id = ?", [productId, companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "archive",
      entityType: "product",
      entityId: productId,
      summary: "Product archived (used in transactions)",
    });
    return;
  }
  run("DELETE FROM products WHERE id = ? AND company_id = ?", [productId, companyId]);
}

/* --------------------------------------------------------------- products */

export type ProductInput = {
  companyId: number;
  sku?: string;
  name: string;
  description?: string;
  type?: "goods" | "service";
  categoryId?: number | null;
  unit?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  minStockMilli?: number;
  barcode?: string;
  incomeAccountId?: number | null;
  expenseAccountId?: number | null;
  isTracked?: boolean;
};

function nextSku(companyId: number): string {
  const row = one<{ count: number }>("SELECT COUNT(*) + 1 AS count FROM products WHERE company_id = ?", [companyId]);
  const stamp = todayISO().slice(2, 4);
  return `P${stamp}-${String(row?.count ?? 1).padStart(4, "0")}`;
}

export function createProduct(input: ProductInput, ctx: Ctx = {}): number {
  if (!input.name?.trim()) throw new ValidationError("NAME_REQUIRED", "Product name is required");
  return tx(() => {
    const sku = input.sku?.trim() || nextSku(input.companyId);
    const duplicate = one<{ id: number }>("SELECT id FROM products WHERE company_id = ? AND sku = ?", [input.companyId, sku]);
    if (duplicate) throw new ValidationError("SKU_EXISTS", `SKU ${sku} already exists`);
    const type = input.type ?? "goods";
    const id = insert(
      `INSERT INTO products (company_id, sku, name, description, type, category_id, unit, purchase_price, selling_price,
         min_stock_milli, barcode, is_tracked, income_account_id, expense_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        sku,
        input.name.trim(),
        input.description ?? null,
        type,
        input.categoryId ?? null,
        input.unit ?? "pcs",
        Math.round(input.purchasePrice ?? 0),
        Math.round(input.sellingPrice ?? 0),
        Math.max(0, Math.round(input.minStockMilli ?? 0)),
        input.barcode ?? null,
        type === "service" ? 0 : (input.isTracked ?? true) ? 1 : 0,
        input.incomeAccountId ?? null,
        input.expenseAccountId ?? null,
        nowISO(),
      ],
    );
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId ?? null,
      userName: ctx.userName ?? null,
      action: "create",
      entityType: "product",
      entityId: id,
      summary: `Product ${sku} ${input.name}`,
    });
    return id;
  });
}

export function updateProduct(companyId: number, productId: number, patch: Partial<ProductInput>, ctx: Ctx = {}): void {
  const current = one<Record<string, unknown>>("SELECT * FROM products WHERE id = ? AND company_id = ?", [productId, companyId]);
  if (!current) throw new ValidationError("NOT_FOUND", "Product not found");
  run(
    `UPDATE products SET sku = COALESCE(?, sku), name = COALESCE(?, name), description = COALESCE(?, description),
       type = COALESCE(?, type), category_id = ?, unit = COALESCE(?, unit), purchase_price = COALESCE(?, purchase_price),
       selling_price = COALESCE(?, selling_price), min_stock_milli = COALESCE(?, min_stock_milli), barcode = COALESCE(?, barcode),
       income_account_id = ?, expense_account_id = ?
     WHERE id = ? AND company_id = ?`,
    [
      patch.sku ?? null,
      patch.name ?? null,
      patch.description ?? null,
      patch.type ?? null,
      patch.categoryId === undefined ? current.category_id : patch.categoryId,
      patch.unit ?? null,
      patch.purchasePrice === undefined ? null : Math.round(patch.purchasePrice),
      patch.sellingPrice === undefined ? null : Math.round(patch.sellingPrice),
      patch.minStockMilli === undefined ? null : Math.round(patch.minStockMilli),
      patch.barcode ?? null,
      patch.incomeAccountId === undefined ? current.income_account_id : patch.incomeAccountId,
      patch.expenseAccountId === undefined ? current.expense_account_id : patch.expenseAccountId,
      productId,
      companyId,
    ],
  );
  recordAudit({
    companyId,
    userId: ctx.userId ?? null,
    userName: ctx.userName ?? null,
    action: "update",
    entityType: "product",
    entityId: productId,
    summary: `Updated product #${productId}`,
  });
}

export function listProducts(companyId: number, options: { search?: string; includeArchived?: boolean } = {}) {
  const conditions = ["company_id = ?"];
  const params: unknown[] = [companyId];
  if (!options.includeArchived) conditions.push("is_archived = 0");
  if (options.search) {
    conditions.push("(name LIKE ? OR sku LIKE ? OR barcode LIKE ?)");
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  return all<{
    id: number;
    sku: string;
    name: string;
    description: string | null;
    type: string;
    category_id: number | null;
    categoryName: string | null;
    unit: string;
    purchase_price: number;
    selling_price: number;
    min_stock_milli: number;
    is_tracked: number;
    is_archived: number;
    qtyMilli: number;
    stockValue: number;
  }>(
    `SELECT p.*, c.name AS categoryName,
            COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS qtyMilli,
            COALESCE((SELECT SUM(b.value) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS stockValue
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${conditions.map((condition) => `p.${condition}`).join(" AND ")}
      ORDER BY p.name`,
    params,
  );
}

export function getProduct(companyId: number, productId: number) {
  return one<Record<string, unknown>>("SELECT * FROM products WHERE id = ? AND company_id = ?", [productId, companyId]);
}
