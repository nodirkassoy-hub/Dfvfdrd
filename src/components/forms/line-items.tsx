"use client";

import * as React from "react";
import { Icon } from "@/components/ui/icon";
import { Button, cx, Field, Input, Select } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { money, qty as fmtQty } from "@/lib/format";
import { fromMinor, toMinor } from "@/lib/money";
import { computeDocument } from "@/lib/services/line-math";
import type { Locale } from "@/lib/i18n/types";

/**
 * Invoice / bill line editor.
 *
 * Totals are computed with the *same* integer helpers the server uses
 * (`lib/services/line-math`), so what the user sees before saving is exactly
 * what the ledger will receive — no rounding surprises.
 */
export type EditorProduct = {
  id: number;
  name: string;
  sku: string;
  unit: string;
  sellingPrice: number;
  purchasePrice: number;
  type: string;
  isTracked: number;
};

export type EditorLine = {
  key: string;
  productId: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  discount: number;
  taxRateBp: number;
};

export type EditorTaxCode = { id: number; name: string; rateBp: number };

let keyCounter = 0;
const nextKey = () => `line-${(keyCounter += 1)}`;

export function emptyLine(taxRateBp = 1200): EditorLine {
  return { key: nextKey(), productId: null, description: "", qty: 1, unitPrice: 0, discount: 0, taxRateBp };
}

export function initialLines(lines?: EditorLine[]): EditorLine[] {
  return lines?.length ? lines.map((line) => ({ ...line, key: nextKey() })) : [emptyLine()];
}

export function serialiseLines(lines: EditorLine[]): string {
  return JSON.stringify(
    lines
      .filter((line) => line.description.trim() && line.qty > 0)
      .map((line) => ({
        productId: line.productId,
        description: line.description.trim(),
        qty: line.qty,
        unitPrice: Math.round(line.unitPrice),
        discount: Math.round(line.discount),
        taxRateBp: line.taxRateBp,
      })),
  );
}

export function LineItemsEditor({
  products,
  taxCodes,
  priceField,
  currency,
  value,
  onChange,
}: {
  products: EditorProduct[];
  taxCodes: EditorTaxCode[];
  priceField: "sellingPrice" | "purchasePrice";
  currency: string;
  value: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
}) {
  const { t, locale } = useApp();
  const update = (key: string, patch: Partial<EditorLine>) =>
    onChange(value.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  /* One computation, the same helper the server uses to post the document. */
  const document = computeDocument(
    value.map((line) => ({
      productId: line.productId,
      description: line.description,
      qtyMilli: Math.round(line.qty * 1000),
      unitPrice: Math.round(line.unitPrice),
      discount: Math.round(line.discount),
      taxRateBp: line.taxRateBp,
    })),
    currency,
  );
  const computed = value.map((line, index) => ({ line, index, math: document.lines[index] }));
  const totals = document;

  return (
    <div className="space-y-2">
      <input type="hidden" name="lines" value={serialiseLines(value)} />
      <div className="hidden gap-2 px-1 text-[11px] uppercase tracking-wide text-subtle lg:grid lg:grid-cols-[minmax(0,3fr)_88px_132px_110px_132px_88px_32px]">
        <span>{t("common.description")}</span>
        <span className="text-right">{t("common.quantity")}</span>
        <span className="text-right">{t("common.unitPrice")}</span>
        <span className="text-right">{t("common.discount")}</span>
        <span className="text-right">{t("common.tax")}</span>
        <span className="text-right">{t("common.total")}</span>
        <span />
      </div>

      {computed.map(({ line, math }) => (
        <div key={line.key} className="grid grid-cols-2 gap-2 rounded-[12px] border border-[color:var(--border)] p-2 lg:grid-cols-[minmax(0,3fr)_88px_132px_110px_132px_88px_32px] lg:border-0 lg:p-0">
          <div className="col-span-2 lg:col-span-1">
            <Select
              value={line.productId ?? ""}
              onChange={(event) => {
                const productId = event.target.value ? Number(event.target.value) : null;
                const product = products.find((entry) => entry.id === productId);
                update(line.key, {
                  productId,
                  description: product?.name ?? line.description,
                  unitPrice: product ? (priceField === "sellingPrice" ? product.sellingPrice : product.purchasePrice) : line.unitPrice,
                });
              }}
              aria-label={t("common.description")}
            >
              <option value="">{t("sales.freeTextLine")}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </Select>
            <Input
              value={line.description}
              onChange={(event) => update(line.key, { description: event.target.value })}
              placeholder={t("sales.lineDescriptionPlaceholder")}
              className="mt-1.5"
              required
            />
          </div>
          <Input
            type="number"
            step="0.001"
            min="0"
            value={line.qty}
            onChange={(event) => update(line.key, { qty: Number(event.target.value) })}
            className="num text-right"
            aria-label={t("common.quantity")}
          />
          <Input
            type="number"
            step="1"
            min="0"
            value={fromMinor(line.unitPrice, currency)}
            onChange={(event) => update(line.key, { unitPrice: toMinor(Number(event.target.value), currency) })}
            className="num text-right"
            aria-label={t("common.unitPrice")}
            title={money(line.unitPrice, currency, locale as Locale)}
          />
          <Input
            type="number"
            step="1"
            min="0"
            value={fromMinor(line.discount, currency)}
            onChange={(event) => update(line.key, { discount: toMinor(Number(event.target.value), currency) })}
            className="num text-right"
            aria-label={t("common.discount")}
          />
          <Select
            value={line.taxRateBp}
            onChange={(event) => update(line.key, { taxRateBp: Number(event.target.value) })}
            aria-label={t("common.tax")}
            className="num"
          >
            {taxCodes.map((code) => (
              <option key={code.id} value={code.rateBp}>
                {code.rateBp / 100}%
              </option>
            ))}
            <option value={0}>0%</option>
          </Select>
          <div className="num flex items-center justify-end text-[13px] font-medium">{money(math.lineTotal, currency, locale as Locale)}</div>
          <button
            type="button"
            onClick={() => onChange(value.length > 1 ? value.filter((entry) => entry.key !== line.key) : [emptyLine()])}
            className="focus-ring flex h-9 w-8 items-center justify-center self-center rounded-[9px] text-subtle hover:text-negative-600"
            aria-label={t("common.delete")}
          >
            <Icon name="trash" size={15} />
          </button>
          <div className="col-span-2 flex items-center justify-between text-[11.5px] text-subtle lg:col-span-6 lg:justify-end lg:gap-4">
            <span className="num lg:hidden">
              {money(math.unitPrice, currency, locale as Locale)} × {fmtQty(Math.round(line.qty * 1000), locale as Locale)}
            </span>
            <span>
              {t("common.subtotal")}: <span className="num">{money(math.netAmount, currency, locale as Locale)}</span>
            </span>
            <span>
              {t("common.tax")}: <span className="num">{money(math.taxAmount, currency, locale as Locale)}</span>
            </span>
          </div>
        </div>
      ))}

      <Button type="button" variant="ghost" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => onChange([...value, emptyLine(value[0]?.taxRateBp ?? 1200)])}>
        {t("common.addLine")}
      </Button>

      <div className="flex justify-end border-t border-[color:var(--border)] pt-3">
        <dl className="w-full max-w-[320px] space-y-1.5 text-[13px]">
          <div className="flex items-center justify-between">
            <dt className="text-muted">{t("common.subtotal")}</dt>
            <dd className="num">{money(totals.subtotal, currency, locale as Locale)}</dd>
          </div>
          {totals.discountTotal > 0 ? (
            <div className="flex items-center justify-between">
              <dt className="text-muted">{t("common.discount")}</dt>
              <dd className="num text-negative-600">−{money(totals.discountTotal, currency, locale as Locale)}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <dt className="text-muted">{t("common.tax")}</dt>
            <dd className="num">{money(totals.taxTotal, currency, locale as Locale)}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-[color:var(--border)] pt-1.5 text-[15px] font-semibold">
            <dt>{t("common.total")}</dt>
            <dd className="num">{money(totals.total, currency, locale as Locale)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-[11px] bg-negative-50 px-3 py-2 text-[12.5px] text-negative-600">
      <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

export const fieldClass = cx("focus-ring h-9 w-full rounded-[10px] border border-[color:var(--border)] surface px-2.5 text-[13px] outline-none");
export { Field };
