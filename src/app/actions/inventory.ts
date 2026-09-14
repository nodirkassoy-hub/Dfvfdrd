"use server";

import { revalidatePath } from "next/cache";
import { insert, nowISO, run } from "@/lib/db";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, dateOf, int, moneyOf, optInt, optStr, qtyMilliOf, str, type ActionState } from "@/lib/actions/support";
import { adjustStock, createProduct, deleteProduct, recordStockMove, transferStock, updateProduct } from "@/lib/services/inventory";
import { todayISO } from "@/lib/dates";

function revalidateInventory() {
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/movements");
  revalidatePath("/inventory/warehouses");
}

export async function saveProductAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    const productId = optInt(form, "productId");
    const payload = {
      companyId: context.company.id,
      sku: optStr(form, "sku"),
      name: str(form, "name"),
      description: optStr(form, "description"),
      type: str(form, "type", "goods") as "goods" | "service",
      categoryId: optInt(form, "categoryId"),
      unit: str(form, "unit", "pcs"),
      purchasePrice: moneyOf(form, "purchasePrice", context.currency),
      sellingPrice: moneyOf(form, "sellingPrice", context.currency),
      minStockMilli: qtyMilliOf(form, "minStock"),
      barcode: optStr(form, "barcode"),
      incomeAccountId: optInt(form, "incomeAccountId"),
      expenseAccountId: optInt(form, "expenseAccountId"),
    };
    const ctx = { userId: context.user.id, userName: context.user.name };

    if (productId) {
      requirePermission(context, "edit");
      updateProduct(context.company.id, productId, payload, ctx);
      revalidateInventory();
      return productId;
    }

    requirePermission(context, "create");
    const id = createProduct(payload, ctx);
    const opening = qtyMilliOf(form, "openingStock");
    if (opening > 0) {
      const warehouseId = optInt(form, "warehouseId");
      if (warehouseId) {
        recordStockMove({
          companyId: context.company.id,
          productId: id,
          warehouseId,
          date: dateOf(form, "openingDate", todayISO()),
          direction: "in",
          qtyMilli: opening,
          unitCost: moneyOf(form, "purchasePrice", context.currency),
          refType: "opening",
          note: "Opening stock",
          ctx,
        });
      }
    }
    revalidateInventory();
    return id;
  });
}

export async function deleteProductAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "delete");
    deleteProduct(context.company.id, int(form, "productId"), { userId: context.user.id, userName: context.user.name });
    revalidateInventory();
    return true;
  });
}

export async function adjustStockAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const signed = qtyMilliOf(form, "quantity");
    const direction = str(form, "direction", "in");
    const result = adjustStock(
      {
        companyId: context.company.id,
        productId: int(form, "productId"),
        warehouseId: int(form, "warehouseId"),
        date: dateOf(form, "date", todayISO()),
        qtyMilli: direction === "in" ? Math.abs(signed) : -Math.abs(signed),
        note: optStr(form, "note"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateInventory();
    return result.entryId ?? 0;
  });
}

export async function transferStockAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    transferStock(
      {
        companyId: context.company.id,
        productId: int(form, "productId"),
        fromWarehouseId: int(form, "fromWarehouseId"),
        toWarehouseId: int(form, "toWarehouseId"),
        date: dateOf(form, "date", todayISO()),
        qtyMilli: qtyMilliOf(form, "quantity"),
        note: optStr(form, "note"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateInventory();
    return true;
  });
}

export async function createWarehouseAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const id = insert("INSERT INTO warehouses (company_id, name, code, address, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      context.company.id,
      str(form, "name"),
      optStr(form, "code") ?? null,
      optStr(form, "address") ?? null,
      0,
      nowISO(),
    ]);
    revalidateInventory();
    return id;
  });
}

export async function createCategoryAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const id = insert("INSERT INTO categories (company_id, name, kind, account_id, created_at) VALUES (?, ?, ?, ?, ?)", [
      context.company.id,
      str(form, "name"),
      str(form, "kind", "expense"),
      optInt(form, "accountId"),
      nowISO(),
    ]);
    revalidatePath("/settings");
    revalidatePath("/purchases/expenses");
    return id;
  });
}

export type { ActionState };
