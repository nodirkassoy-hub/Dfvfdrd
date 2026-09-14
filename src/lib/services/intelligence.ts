/**
 * BUXAI intelligence layer.
 *
 * Every number produced here is computed by the accounting engine from posted
 * journal lines. The language layer only *phrases* those numbers — it never
 * generates them. When a question touches tax rules, the answer carries the
 * source and a verification requirement instead of a definitive legal claim.
 */
import { all, one } from "@/lib/db";
import {
  accountsPayable,
  accountsReceivable,
  cashBalance,
  cashFlowStatement,
  cashMovement,
  drillDown,
  expenseBreakdown,
  incomeStatement,
  monthlySeries,
  payablesAging,
  receivablesAging,
  topContactsByRevenue,
  type DrillDownLine,
} from "@/lib/accounting/ledger";
import { TAX_SOURCES } from "@/lib/accounting/coa";
import { formatDate, monthKey, monthRange, resolvePeriod, todayISO, type Period } from "@/lib/dates";
import { formatMoney, percentChange } from "@/lib/money";
import type { Locale } from "@/lib/i18n/types";

export type Figure = { label: string; value: number; currency?: string; hint?: string };

export type AiAnswer = {
  intent: string;
  headline: string;
  body: string;
  figures: Figure[];
  calculation: string | null;
  transactions: DrillDownLine[];
  reportLink: string | null;
  confidenceBp: number;
  needsVerification: boolean;
  sources: { label: string; url: string; note: string }[];
};

function pick(locale: Locale, text: { en: string; uz: string; ru: string }): string {
  return locale === "ru" ? text.ru : locale === "uz" ? text.uz : text.en;
}

function money(value: number, currency: string, locale: Locale): string {
  return formatMoney(value, { currency, showCode: true, locale: locale === "ru" ? "ru" : "en" });
}

export type QuestionContext = {
  companyId: number;
  companyName: string;
  currency: string;
  locale: Locale;
  period: Period;
};

function periodMetrics(ctx: QuestionContext) {
  const { companyId, period } = ctx;
  const is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  const cash = cashBalance(companyId, period.to);
  const movement = cashMovement(companyId, period.from, period.to);
  const ar = accountsReceivable(companyId, period.to);
  const ap = accountsPayable(companyId, period.to);
  return { is, cash, movement, ar, ap };
}

const INTENT_PATTERNS: { intent: string; patterns: RegExp[] }[] = [
  { intent: "profit", patterns: [/foyda|foydamiz|соф фойда|прибыл|profit|marja|rentabellik|рентабельн|маржа/i] },
  { intent: "biggest_expense", patterns: [/eng katta xarajat|qaysi xarajat|сам[аы][яе]?\s*больш|крупн[а-я]*\s*расход|biggest expense|largest expense|top expense/i] },
  { intent: "receivables", patterns: [/qarzdor|debitor|kim bizdan|должн|дебитор|who owes|outstanding|receivable/i] },
  { intent: "overdue", patterns: [/muddati o'tgan|kechikkan|просроч|overdue|late payment/i] },
  { intent: "payables", patterns: [/kreditor|qarzimiz|поставщик|кредитор|payable|owe to|to'lov qilishimiz kerak|kimga qarz/i] },
  { intent: "cash_gap", patterns: [/pul yetishmay|kassa uzilish|кассов[а-я]*\s*разрыв|cash gap|cash shortage|shortage risk|pulimiz yetadimi/i] },
  { intent: "cash", patterns: [/kassa|bankdagi|pul mablag|hozirgi pul|денежн|касса|остаток|bank balance|cash balance|how much cash/i] },
  { intent: "tax", patterns: [/soliq|qqs|ндс|налог|vat|tax\b|пошлин/i] },
  { intent: "top_customers", patterns: [/mijoz|buyurtmachi|клиент|покупател|customer|top client/i] },
  { intent: "runway", patterns: [/qancha yetadi|runway|на сколько хватит|запас денег|burn/i] },
  { intent: "forecast", patterns: [/prognoz|прогноз|forecast|kelasi oy|next month|future cash/i] },
  { intent: "health", patterns: [/sog'lom|moliyaviy holat|здоров|финансовое состояние|health score|baholash|оценк/i] },
  { intent: "budget", patterns: [/byudjet|бюджет|budget|reja|план/i] },
  { intent: "growth", patterns: [/o'sish|oshib|рост|динамик|growth|trend|compare|solishtir/i] },
  { intent: "validation", patterns: [/to'g'rimi|to'gri\?|верно|correct|is this right|check this|xato bormi/i] },
  { intent: "expenses", patterns: [/xarajat|расход|expense|spend|cost(?! of goods)/i] },
  { intent: "revenue", patterns: [/tushum|daromad|выручк|доход|revenue|sales|sotuv/i] },
  { intent: "overview", patterns: [/.*/] },
];

export function detectIntent(question: string): string {
  for (const entry of INTENT_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(question))) return entry.intent;
  }
  return "overview";
}

export function answerQuestion(ctx: QuestionContext, question: string): AiAnswer {
  const intent = detectIntent(question);
  const { is, cash, movement, ar, ap } = periodMetrics(ctx);
  const currency = ctx.currency;
  const locale = ctx.locale;
  const periodLabel = `${formatDate(ctx.period.from, locale)} – ${formatDate(ctx.period.to, locale)}`;

  const base = {
    intent,
    calculation: null as string | null,
    transactions: [] as DrillDownLine[],
    reportLink: null as string | null,
    confidenceBp: 9500,
    needsVerification: false,
    sources: [] as AiAnswer["sources"],
  };

  switch (intent) {
    case "profit": {
      const change = percentChange(is.netProfit, is.netProfitPrevious);
      return {
        ...base,
        headline: pick(locale, {
          en: `Net profit for ${periodLabel} is ${money(is.netProfit, currency, locale)}`,
          uz: `${periodLabel} uchun sof foyda — ${money(is.netProfit, currency, locale)}`,
          ru: `Чистая прибыль за ${periodLabel}: ${money(is.netProfit, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `Revenue ${money(is.revenue.total, currency, locale)} minus cost of goods sold ${money(is.cogs.total, currency, locale)} and operating expenses ${money(is.operatingExpenses.total, currency, locale)}${change === null ? "" : `, which is ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}% versus the previous period`}. Net margin is ${is.margins.net?.toFixed(1) ?? "—"}%.`,
          uz: `Tushum ${money(is.revenue.total, currency, locale)} dan sotilgan tovar tannarxi ${money(is.cogs.total, currency, locale)} va operatsion xarajatlar ${money(is.operatingExpenses.total, currency, locale)} ayirildi${change === null ? "" : `, bu o'tgan davrga nisbatan ${Math.abs(change).toFixed(1)}% ${change >= 0 ? "ko'p" : "kam"}`}. Sof marja — ${is.margins.net?.toFixed(1) ?? "—"}%.`,
          ru: `Выручка ${money(is.revenue.total, currency, locale)} минус себестоимость ${money(is.cogs.total, currency, locale)} и операционные расходы ${money(is.operatingExpenses.total, currency, locale)}${change === null ? "" : `; изменение к предыдущему периоду ${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`}. Чистая маржа — ${is.margins.net?.toFixed(1) ?? "—"}%.`,
        }),
        figures: [
          { label: pick(locale, { en: "Revenue", uz: "Tushum", ru: "Выручка" }), value: is.revenue.total, currency },
          { label: pick(locale, { en: "Cost of goods sold", uz: "Tannarx", ru: "Себестоимость" }), value: is.cogs.total, currency },
          { label: pick(locale, { en: "Operating expenses", uz: "Operatsion xarajatlar", ru: "Операционные расходы" }), value: is.operatingExpenses.total, currency },
          { label: pick(locale, { en: "Net profit", uz: "Sof foyda", ru: "Чистая прибыль" }), value: is.netProfit, currency },
        ],
        calculation: pick(locale, {
          en: "Net profit = revenue − cost of goods sold − operating expenses + other income − other expenses, taken from posted journal entries in the selected period.",
          uz: "Sof foyda = tushum − tannarx − operatsion xarajatlar + boshqa daromadlar − boshqa xarajatlar. Barchasi tanlangan davrdagi yozilgan jurnal yozuvlaridan olinadi.",
          ru: "Чистая прибыль = выручка − себестоимость − операционные расходы + прочие доходы − прочие расходы, по проведённым проводкам периода.",
        }),
        reportLink: "/reports/profit-loss",
      };
    }

    case "biggest_expense": {
      const breakdown = expenseBreakdown(ctx.companyId, ctx.period.from, ctx.period.to, ctx.period.previousFrom, ctx.period.previousTo);
      const top = breakdown[0];
      if (!top) {
        return {
          ...base,
          headline: pick(locale, { en: "No expenses recorded in this period", uz: "Bu davrda xarajat qayd etilmagan", ru: "За период расходов нет" }),
          body: pick(locale, {
            en: "There are no expense postings in the selected period, so there is no largest expense to report.",
            uz: "Tanlangan davrda xarajat yozuvlari yo'q, shuning uchun eng katta xarajatni ko'rsatib bo'lmaydi.",
            ru: "В выбранном периоде расходных проводок нет, поэтому крупнейший расход не определяется.",
          }),
          figures: [],
        };
      }
      const lines = drillDown(ctx.companyId, {
        accountIds: top.accountId ? [top.accountId] : undefined,
        from: ctx.period.from,
        to: ctx.period.to,
        limit: 6,
      });
      return {
        ...base,
        headline: pick(locale, {
          en: `Largest expense: ${top.label} — ${money(top.amount, currency, locale)}`,
          uz: `Eng katta xarajat: ${top.label} — ${money(top.amount, currency, locale)}`,
          ru: `Крупнейший расход: ${top.label} — ${money(top.amount, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `This is ${top.share.toFixed(1)}% of all expenses in the period${top.changePct === null ? "" : `, ${top.changePct >= 0 ? "up" : "down"} ${Math.abs(top.changePct).toFixed(1)}% versus the previous period`}. The transactions below are the exact postings behind the figure.`,
          uz: `Bu davrdagi barcha xarajatlarning ${top.share.toFixed(1)}% i${top.changePct === null ? "" : `, o'tgan davrga nisbatan ${Math.abs(top.changePct).toFixed(1)}% ${top.changePct >= 0 ? "ko'p" : "kam"}`}. Quyidagi operatsiyalar shu summani shakllantirgan.`,
          ru: `Это ${top.share.toFixed(1)}% всех расходов периода${top.changePct === null ? "" : `, изменение ${top.changePct >= 0 ? "+" : "−"}${Math.abs(top.changePct).toFixed(1)}%`}. Ниже — операции, из которых сложилась сумма.`,
        }),
        figures: breakdown.slice(0, 5).map((row) => ({ label: row.label, value: row.amount, currency, hint: `${row.share.toFixed(1)}%` })),
        transactions: lines,
        reportLink: "/reports/expense-report",
      };
    }

    case "receivables": {
      const aging = receivablesAging(ctx.companyId, ctx.period.to);
      const total = aging.reduce((sum, row) => sum + row.total, 0);
      const top = aging.slice(0, 5);
      return {
        ...base,
        headline: pick(locale, {
          en: `Customers owe ${money(total, currency, locale)}`,
          uz: `Mijozlar ${money(total, currency, locale)} qarz`,
          ru: `Клиенты должны ${money(total, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `The general ledger receivable balance is ${money(Math.abs(ar), currency, locale)}. ${top.length ? `Largest debtors: ${top.map((row) => `${row.contactName} (${money(row.total, currency, locale)})`).join(", ")}.` : "There are no unpaid invoices."} Figures come from unpaid invoices and are cross-checked against account 1101.`,
          uz: `Bosh daftar bo'yicha debitorlik qoldig'i — ${money(Math.abs(ar), currency, locale)}. ${top.length ? `Eng katta qarzdorlar: ${top.map((row) => `${row.contactName} (${money(row.total, currency, locale)})`).join(", ")}.` : "To'lanmagan fakturalar yo'q."} Summalar to'lanmagan fakturalardan olinadi va 1101 hisobi bilan solishtiriladi.`,
          ru: `Сальдо дебиторской задолженности по главной книге — ${money(Math.abs(ar), currency, locale)}. ${top.length ? `Крупнейшие должники: ${top.map((row) => `${row.contactName} (${money(row.total, currency, locale)})`).join(", ")}.` : "Неоплаченных счетов нет."} Данные берутся из неоплаченных счетов и сверяются со счётом 1101.`,
        }),
        figures: top.map((row) => ({ label: row.contactName, value: row.total, currency, hint: row.d90_plus > 0 ? "90+ days" : "" })),
        transactions: drillDown(ctx.companyId, { types: ["revenue"], from: ctx.period.from, to: ctx.period.to, limit: 8 }),
        reportLink: "/reports/receivables",
      };
    }

    case "overdue": {
      const rows = all<{
        number: string;
        customerName: string;
        dueDate: string;
        amountDue: number;
        daysOverdue: number;
      }>(
        `SELECT i.number, c.name AS customerName, i.due_date AS dueDate, i.total - i.amount_paid AS amountDue,
                CAST(julianday(date('now')) - julianday(i.due_date) AS INTEGER) AS daysOverdue
           FROM invoices i JOIN contacts c ON c.id = i.contact_id
          WHERE i.company_id = ? AND i.status = 'overdue' AND i.total > i.amount_paid
          ORDER BY i.due_date ASC LIMIT 20`,
        [ctx.companyId],
      );
      const total = rows.reduce((sum, row) => sum + row.amountDue, 0);
      return {
        ...base,
        headline: rows.length
          ? pick(locale, {
              en: `${rows.length} overdue invoice${rows.length === 1 ? "" : "s"} worth ${money(total, currency, locale)}`,
              uz: `${rows.length} ta muddati o'tgan faktura, jami ${money(total, currency, locale)}`,
              ru: `${rows.length} просроченных счетов на ${money(total, currency, locale)}`,
            })
          : pick(locale, { en: "No overdue invoices", uz: "Muddati o'tgan fakturalar yo'q", ru: "Просроченных счетов нет" }),
        body: rows.length
          ? rows.map((row) => `${row.number} · ${row.customerName} · ${money(row.amountDue, currency, locale)} · ${row.daysOverdue} ${pick(locale, { en: "days late", uz: "kun kechikdi", ru: "дн. просрочки" })}`).join("\n")
          : pick(locale, {
              en: "Every issued invoice is either paid or still within its payment term.",
              uz: "Barcha berilgan fakturalar to'langan yoki muddati hali o'tmagan.",
              ru: "Все выставленные счета оплачены либо срок ещё не истёк.",
            }),
        figures: [{ label: pick(locale, { en: "Overdue total", uz: "Muddati o'tgan jami", ru: "Просрочено всего" }), value: total, currency }],
        transactions: drillDown(ctx.companyId, { types: ["revenue"], from: ctx.period.previousFrom, to: ctx.period.to, limit: 8 }),
        reportLink: "/sales/invoices?status=overdue",
      };
    }

    case "payables": {
      const aging = payablesAging(ctx.companyId, ctx.period.to);
      const total = aging.reduce((sum, row) => sum + row.total, 0);
      return {
        ...base,
        headline: pick(locale, {
          en: `You owe suppliers ${money(total, currency, locale)}`,
          uz: `Yetkazib beruvchilarga ${money(total, currency, locale)} qarz`,
          ru: `Поставщикам вы должны ${money(total, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `Ledger payable balance (account 2011) is ${money(Math.abs(ap), currency, locale)}. ${aging.length ? `Largest: ${aging.slice(0, 4).map((row) => `${row.contactName} (${money(row.total, currency, locale)})`).join(", ")}.` : "There are no unpaid supplier bills."}`,
          uz: `Kreditorlik qoldig'i (2011 hisobi) — ${money(Math.abs(ap), currency, locale)}. ${aging.length ? `Eng katta: ${aging.slice(0, 4).map((row) => `${row.contactName} (${money(row.total, currency, locale)})`).join(", ")}.` : "To'lanmagan hisoblar yo'q."}`,
          ru: `Сальдо кредиторской задолженности (счёт 2011) — ${money(Math.abs(ap), currency, locale)}. ${aging.length ? `Крупнейшие: ${aging.slice(0, 4).map((row) => `${row.contactName} (${money(row.total, currency, locale)})`).join(", ")}.` : "Неоплаченных счетов поставщиков нет."}`,
        }),
        figures: aging.slice(0, 5).map((row) => ({ label: row.contactName, value: row.total, currency })),
        reportLink: "/reports/payables",
      };
    }

    case "cash":
    case "cash_gap": {
      const forecast = cashForecast(ctx.companyId, 90);
      const firstShortage = forecast.shortages[0];
      return {
        ...base,
        headline: pick(locale, {
          en: `Cash and bank today: ${money(cash, currency, locale)}`,
          uz: `Bugungi pul mablag'lari: ${money(cash, currency, locale)}`,
          ru: `Денежные средства сегодня: ${money(cash, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `Inflow ${money(movement.inflow, currency, locale)} and outflow ${money(movement.outflow, currency, locale)} in the period, net ${money(movement.net, currency, locale)}.${firstShortage ? ` Based on invoices due, bills to pay, payroll and taxes, the projected balance dips below zero around ${formatDate(firstShortage.date, locale)} (lowest point ${money(firstShortage.balance, currency, locale)}).` : ` On the same basis the projected balance stays positive for the next 90 days (minimum ${money(forecast.minBalance, currency, locale)}).`}`,
          uz: `Davrda kirim ${money(movement.inflow, currency, locale)}, chiqim ${money(movement.outflow, currency, locale)}, sof ${money(movement.net, currency, locale)}.${firstShortage ? ` Fakturalar, hisoblar, ish haqi va soliqlar asosida taxminan ${formatDate(firstShortage.date, locale)} da qoldiq noldan pastga tushadi (eng past nuqta ${money(firstShortage.balance, currency, locale)}).` : ` Xuddi shu asosda keyingi 90 kunda qoldiq musbat qoladi (minimal ${money(forecast.minBalance, currency, locale)}).`}`,
          ru: `Поступление ${money(movement.inflow, currency, locale)}, списание ${money(movement.outflow, currency, locale)}, чистое изменение ${money(movement.net, currency, locale)}.${firstShortage ? ` По счетам к оплате, закупкам, зарплате и налогам остаток уходит ниже нуля около ${formatDate(firstShortage.date, locale)} (минимум ${money(firstShortage.balance, currency, locale)}).` : ` При тех же допущениях остаток остаётся положительным на 90 дней вперёд (минимум ${money(forecast.minBalance, currency, locale)}).`}`,
        }),
        figures: [
          { label: pick(locale, { en: "Cash & bank", uz: "Pul mablag'lari", ru: "Деньги и банк" }), value: cash, currency },
          { label: pick(locale, { en: "Expected inflows (90d)", uz: "Kutilayotgan kirim (90 kun)", ru: "Ожидаемые поступления (90 дн.)" }), value: forecast.inflowTotal, currency },
          { label: pick(locale, { en: "Expected outflows (90d)", uz: "Kutilayotgan chiqim (90 kun)", ru: "Ожидаемые списания (90 дн.)" }), value: forecast.outflowTotal, currency },
          { label: pick(locale, { en: "Projected 90-day balance", uz: "90 kundan keyingi qoldiq", ru: "Прогноз остатка через 90 дней" }), value: forecast.endBalance, currency },
        ],
        calculation: pick(locale, {
          en: "Forecast = current cash + unpaid invoices by due date + expected collections from your last 3 months of receipts − unpaid bills and expenses by due date − average monthly payroll − tax liabilities due.",
          uz: "Prognoz = bugungi pul + muddati bo'yicha to'lanmagan fakturalar + oxirgi 3 oylik tushumlar asosidagi kutilayotgan undirish − muddati bo'yicha to'lanmagan hisoblar va xarajatlar − o'rtacha oylik ish haqi − muddati kelgan soliqlar.",
          ru: "Прогноз = текущие деньги + неоплаченные счета по срокам + ожидаемые поступления по среднему за 3 месяца − неоплаченные счёта и расходы по срокам − средняя месячная зарплата − налоги к сроку.",
        }),
        reportLink: "/reports/cash-flow",
      };
    }

    case "tax": {
      const tax = taxOverview(ctx.companyId, ctx.period);
      return {
        ...base,
        headline: pick(locale, {
          en: `Estimated tax position for ${periodLabel}: ${money(tax.totalEstimated, currency, locale)}`,
          uz: `${periodLabel} uchun taxminiy soliq majburiyati: ${money(tax.totalEstimated, currency, locale)}`,
          ru: `Оценочные налоговые обязательства за ${periodLabel}: ${money(tax.totalEstimated, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `VAT: output ${money(tax.vat.output, currency, locale)} − input ${money(tax.vat.input, currency, locale)} = ${money(tax.vat.payable, currency, locale)}. Payroll taxes: ${money(tax.payroll.total, currency, locale)}. This is a calculation from your own ledger, not a filed return.`,
          uz: `QQS: hisoblangan ${money(tax.vat.output, currency, locale)} − hisobga olinadigan ${money(tax.vat.input, currency, locale)} = ${money(tax.vat.payable, currency, locale)}. Ish haqi soliqlari: ${money(tax.payroll.total, currency, locale)}. Bu sizning jurnalingiz asosidagi hisob-kitob, taqdim etilgan deklaratsiya emas.`,
          ru: `НДС: исходящий ${money(tax.vat.output, currency, locale)} − входящий ${money(tax.vat.input, currency, locale)} = ${money(tax.vat.payable, currency, locale)}. Налоги с зарплаты: ${money(tax.payroll.total, currency, locale)}. Это расчёт по вашему журналу, а не сданная отчётность.`,
        }),
        figures: [
          { label: pick(locale, { en: "Output VAT", uz: "Hisoblangan QQS", ru: "Исходящий НДС" }), value: tax.vat.output, currency },
          { label: pick(locale, { en: "Input VAT", uz: "Kirim QQS", ru: "Входящий НДС" }), value: tax.vat.input, currency },
          { label: pick(locale, { en: "VAT payable", uz: "To'lanadigan QQS", ru: "НДС к уплате" }), value: tax.vat.payable, currency },
          { label: pick(locale, { en: "Payroll taxes", uz: "Ish haqi soliqlari", ru: "Налоги с зарплаты" }), value: tax.payroll.total, currency },
        ],
        calculation: tax.calculation,
        needsVerification: true,
        sources: TAX_SOURCES.map((source) => ({ label: source.label, url: source.url, note: source.note })),
        reportLink: "/tax-center",
      };
    }

    case "top_customers": {
      const ranked = topContactsByRevenue(ctx.companyId, ctx.period.from, ctx.period.to, ctx.period.previousFrom, ctx.period.previousTo, 8);
      const totalRevenue = is.revenue.total;
      return {
        ...base,
        headline: ranked.length
          ? pick(locale, {
              en: `${ranked[0].name} is the top customer with ${money(ranked[0].revenue, currency, locale)}`,
              uz: `Eng yirik mijoz — ${ranked[0].name}, ${money(ranked[0].revenue, currency, locale)}`,
              ru: `Крупнейший клиент — ${ranked[0].name}, ${money(ranked[0].revenue, currency, locale)}`,
            })
          : pick(locale, { en: "No customer revenue in this period", uz: "Bu davrda mijoz tushumi yo'q", ru: "За период выручки по клиентам нет" }),
        body: ranked
          .map(
            (row) =>
              `${row.name}: ${money(row.revenue, currency, locale)}${totalRevenue ? ` (${((row.revenue / totalRevenue) * 100).toFixed(1)}% ${pick(locale, { en: "of revenue", uz: "tushumdan", ru: "выручки" })})` : ""}${row.outstanding > 0 ? `, ${money(row.outstanding, currency, locale)} ${pick(locale, { en: "outstanding", uz: "to'lanmagan", ru: "не оплачено" })}` : ""}`,
          )
          .join("\n"),
        figures: ranked.slice(0, 5).map((row) => ({ label: row.name, value: row.revenue, currency })),
        reportLink: "/reports/revenue-report",
      };
    }

    case "runway": {
      const forecast = cashForecast(ctx.companyId, 180);
      const burn = averageMonthlyOutflow(ctx.companyId);
      const runwayMonths = burn > 0 ? cash / burn : null;
      return {
        ...base,
        headline:
          runwayMonths === null
            ? pick(locale, { en: `Cash on hand: ${money(cash, currency, locale)}`, uz: `Pul mablag'lari: ${money(cash, currency, locale)}`, ru: `Денежные средства: ${money(cash, currency, locale)}` })
            : pick(locale, {
                en: `At the current burn rate your cash lasts about ${runwayMonths.toFixed(1)} months`,
                uz: `Joriy sarf bilan pulingiz taxminan ${runwayMonths.toFixed(1)} oyga yetadi`,
                ru: `При текущем расходе денег хватит примерно на ${runwayMonths.toFixed(1)} мес.`,
              }),
        body: pick(locale, {
          en: `Average monthly outflow over the last 3 months is ${money(burn, currency, locale)}; cash on hand is ${money(cash, currency, locale)}. ${forecast.shortages.length ? `A shortage is projected near ${formatDate(forecast.shortages[0].date, locale)} if nothing changes.` : "No shortage is projected in the next 180 days on current commitments."}`,
          uz: `Oxirgi 3 oydagi o'rtacha oylik chiqim ${money(burn, currency, locale)}, qo'ldagi pul ${money(cash, currency, locale)}. ${forecast.shortages.length ? `Hech narsa o'zgarmasa, taxminan ${formatDate(forecast.shortages[0].date, locale)} da pul yetishmovchiligi kutiladi.` : "Joriy majburiyatlar bilan keyingi 180 kunda yetishmovchilik kutilmaydi."}`,
          ru: `Средний месячный расход за 3 месяца — ${money(burn, currency, locale)}, денег на счетах — ${money(cash, currency, locale)}. ${forecast.shortages.length ? `Без изменений разрыв ожидается около ${formatDate(forecast.shortages[0].date, locale)}.` : "На 180 дней вперёд разрыва не прогнозируется."}`,
        }),
        figures: [
          { label: pick(locale, { en: "Cash & bank", uz: "Pul mablag'lari", ru: "Деньги и банк" }), value: cash, currency },
          { label: pick(locale, { en: "Average monthly outflow", uz: "O'rtacha oylik chiqim", ru: "Средний месячный расход" }), value: burn, currency },
        ],
        reportLink: "/reports/cash-flow",
      };
    }

    case "forecast": {
      const forecast = cashForecast(ctx.companyId, 90);
      const series = monthlySeries(ctx.companyId, addMonthsISO(ctx.period.from, -6), ctx.period.to);
      const lastThree = series.slice(-3);
      const avgRevenue = lastThree.length ? lastThree.reduce((sum, point) => sum + point.revenue, 0) / lastThree.length : 0;
      const avgProfit = lastThree.length ? lastThree.reduce((sum, point) => sum + point.netProfit, 0) / lastThree.length : 0;
      return {
        ...base,
        headline: pick(locale, {
          en: `Projected 90-day cash position: ${money(forecast.endBalance, currency, locale)}`,
          uz: `90 kunlik prognoz qoldiq: ${money(forecast.endBalance, currency, locale)}`,
          ru: `Прогноз остатка на 90 дней: ${money(forecast.endBalance, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `The projection uses committed items only. Over the last 3 months you averaged ${money(avgRevenue, currency, locale)} revenue and ${money(avgProfit, currency, locale)} net profit per month. ${forecast.shortages.length ? `Watch ${formatDate(forecast.shortages[0].date, locale)}: the balance is projected to dip below zero.` : "The projected balance stays positive."}`,
          uz: `Prognoz faqat aniq majburiyatlarga asoslangan. Oxirgi 3 oyda o'rtacha oylik tushum ${money(avgRevenue, currency, locale)}, sof foyda ${money(avgProfit, currency, locale)}. ${forecast.shortages.length ? `${formatDate(forecast.shortages[0].date, locale)} sanasiga e'tibor bering: qoldiq noldan pastga tushishi mumkin.` : "Prognoz qoldiq musbat qolmoqda."}`,
          ru: `Прогноз учитывает только подтверждённые обязательства. За последние 3 месяца в среднем: выручка ${money(avgRevenue, currency, locale)}, чистая прибыль ${money(avgProfit, currency, locale)} в месяц. ${forecast.shortages.length ? `Обратите внимание на ${formatDate(forecast.shortages[0].date, locale)}: остаток может уйти в минус.` : "Прогнозируемый остаток остаётся положительным."}`,
        }),
        figures: [
          { label: pick(locale, { en: "Expected inflows (90d)", uz: "Kutilayotgan kirim", ru: "Ожидаемые поступления" }), value: forecast.inflowTotal, currency },
          { label: pick(locale, { en: "Expected outflows (90d)", uz: "Kutilayotgan chiqim", ru: "Ожидаемые списания" }), value: forecast.outflowTotal, currency },
          { label: pick(locale, { en: "Projected balance (90d)", uz: "Prognoz qoldiq (90 kun)", ru: "Прогноз остатка" }), value: forecast.endBalance, currency },
        ],
        calculation: predictCalculation(locale),
        reportLink: "/reports/cash-flow",
      };
    }

    case "health": {
      const health = financialHealth(ctx.companyId, ctx.period);
      return {
        ...base,
        headline: pick(locale, {
          en: `Financial health score: ${health.score}/100 (${health.band})`,
          uz: `Moliyaviy sog'lomlik bali: ${health.score}/100 (${health.band})`,
          ru: `Оценка финансового здоровья: ${health.score}/100 (${health.band})`,
        }),
        body: health.factors.map((factor) => `${factor.label}: ${factor.score}/100 — ${factor.detail}`).join("\n"),
        figures: health.factors.map((factor) => ({ label: factor.label, value: factor.score, hint: `${factor.weight}%` })),
        calculation: pick(locale, {
          en: "The score is a weighted average of net margin, revenue growth, cash runway, receivables risk, expense discipline and operational hygiene. Each component is computed from posted ledger data.",
          uz: "Bal sof marja, tushum o'sishi, pul zaxirasi, debitorlik xavfi, xarajat intizomi va operatsion tartibning vaznli o'rtachasidir. Har bir qism jurnal ma'lumotlaridan hisoblanadi.",
          ru: "Оценка — взвешенное среднее маржи, роста выручки, запаса денег, риска дебиторки, дисциплины расходов и операционной гигиены. Каждый компонент считается по данным журнала.",
        }),
        reportLink: "/reports/management-reports",
      };
    }

    case "growth": {
      const series = monthlySeries(ctx.companyId, ctx.period.from, ctx.period.to);
      const revenueChange = percentChange(is.revenue.total, is.revenue.previousTotal);
      const expenseChange = percentChange(is.operatingExpenses.total, is.operatingExpenses.previousTotal);
      return {
        ...base,
        headline: pick(locale, {
          en: `Revenue ${revenueChange === null ? "n/a" : `${revenueChange >= 0 ? "+" : ""}${revenueChange.toFixed(1)}%`} vs expenses ${expenseChange === null ? "n/a" : `${expenseChange >= 0 ? "+" : ""}${expenseChange.toFixed(1)}%`}`,
          uz: `Tushum ${revenueChange === null ? "—" : `${revenueChange >= 0 ? "+" : ""}${revenueChange.toFixed(1)}%`}, xarajatlar ${expenseChange === null ? "—" : `${expenseChange >= 0 ? "+" : ""}${expenseChange.toFixed(1)}%`}`,
          ru: `Выручка ${revenueChange === null ? "—" : `${revenueChange >= 0 ? "+" : ""}${revenueChange.toFixed(1)}%`}, расходы ${expenseChange === null ? "—" : `${expenseChange >= 0 ? "+" : ""}${expenseChange.toFixed(1)}%`}`,
        }),
        body: pick(locale, {
          en: `${series.length ? `Monthly revenue: ${series.map((point) => `${monthKey(point.month)}: ${money(point.revenue, currency, locale)}`).join(", ")}.` : ""} ${revenueChange !== null && expenseChange !== null && expenseChange > revenueChange ? "Expenses grew faster than revenue in this comparison, which compresses margin." : "Revenue and expenses moved in line in this comparison."}`,
          uz: `${series.length ? `Oylik tushum: ${series.map((point) => `${monthKey(point.month)}: ${money(point.revenue, currency, locale)}`).join(", ")}.` : ""} ${revenueChange !== null && expenseChange !== null && expenseChange > revenueChange ? "Bu taqqoslashda xarajatlar tushumdan tez o'sdi — marja qisqaradi." : "Bu taqqoslashda tushum va xarajat bir maromda o'zgardi."}`,
          ru: `${series.length ? `Выручка по месяцам: ${series.map((point) => `${monthKey(point.month)}: ${money(point.revenue, currency, locale)}`).join(", ")}.` : ""} ${revenueChange !== null && expenseChange !== null && expenseChange > revenueChange ? "В этом сравнении расходы росли быстрее выручки — маржа сжимается." : "Выручка и расходы изменились соразмерно."}`,
        }),
        figures: [
          { label: pick(locale, { en: "Revenue", uz: "Tushum", ru: "Выручка" }), value: is.revenue.total, currency },
          { label: pick(locale, { en: "Operating expenses", uz: "Operatsion xarajatlar", ru: "Операционные расходы" }), value: is.operatingExpenses.total, currency },
          { label: pick(locale, { en: "Net profit", uz: "Sof foyda", ru: "Чистая прибыль" }), value: is.netProfit, currency },
        ],
        reportLink: "/reports/management-reports",
      };
    }

    case "budget": {
      const rows = all<{ name: string; budget: number; actual: number }>(
        `SELECT b.name, b.amount AS budget, 0 AS actual FROM budgets b WHERE b.company_id = ? LIMIT 20`,
        [ctx.companyId],
      );
      return {
        ...base,
        headline: pick(locale, {
          en: rows.length ? `${rows.length} budget lines configured` : "No budgets configured yet",
          uz: rows.length ? `${rows.length} ta byudjet qatori kiritilgan` : "Byudjet hali kiritilmagan",
          ru: rows.length ? `Настроено бюджетных строк: ${rows.length}` : "Бюджеты пока не настроены",
        }),
        body: pick(locale, {
          en: rows.length
            ? "Open Budgeting to compare each line against actual ledger figures, with variance in currency and percent."
            : "Set a budget by month, quarter or year and BUXAI will compare it against real ledger figures automatically.",
          uz: rows.length
            ? "Har bir qatorni haqiqiy jurnal raqamlari bilan solishtirish uchun Byudjetlashtirish bo'limini oching."
            : "Oy, chorak yoki yil uchun byudjet kiriting — BUXAI uni haqiqiy jurnal raqamlari bilan avtomatik solishtiradi.",
          ru: rows.length
            ? "Откройте «Бюджетирование», чтобы сравнить каждую строку с фактическими данными журнала."
            : "Задайте бюджет на месяц, квартал или год — BUXAI автоматически сравнит его с фактическими данными журнала.",
        }),
        figures: rows.map((row) => ({ label: row.name, value: row.budget, currency })),
        reportLink: "/reports/budget-vs-actual",
      };
    }

    case "validation": {
      const control = one<{ debit: number; credit: number; entries: number }>(
        `SELECT COALESCE(SUM(l.base_debit),0) AS debit, COALESCE(SUM(l.base_credit),0) AS credit, COUNT(DISTINCT e.id) AS entries
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.company_id = ? AND e.status = 'posted'`,
        [ctx.companyId],
      );
      const difference = (control?.debit ?? 0) - (control?.credit ?? 0);
      return {
        ...base,
        headline:
          difference === 0
            ? pick(locale, {
                en: "The ledger is balanced — debits equal credits",
                uz: "Jurnal muvozanatda — debet va kredit teng",
                ru: "Журнал сбалансирован — дебет равен кредиту",
              })
            : pick(locale, {
                en: `The ledger is out of balance by ${money(difference, currency, locale)}`,
                uz: `Jurnal ${money(difference, currency, locale)} ga muvozanatdan chiqqan`,
                ru: `Журнал не сбалансирован на ${money(difference, currency, locale)}`,
              }),
        body: pick(locale, {
          en: `${control?.entries ?? 0} journal entries were checked. Every entry is validated before posting, so an imbalance can only come from a manual database change — Xato Radar flags this as critical.`,
          uz: `${control?.entries ?? 0} jurnal yozuvi tekshirildi. Har bir yozuv saqlashdan oldin tekshiriladi, shuning uchun muvozanatsizlik faqat bazaga qo'lda aralashuvdan kelib chiqishi mumkin — Xato Radar buni kritik deb belgilaydi.`,
          ru: `Проверено проводок: ${control?.entries ?? 0}. Каждая проводка валидируется до проведения, поэтому расбалансировка возможна только при ручном изменении базы — Xato Radar отметит это как критичное.`,
        }),
        figures: [
          { label: pick(locale, { en: "Total debit", uz: "Jami debet", ru: "Итого дебет" }), value: control?.debit ?? 0, currency },
          { label: pick(locale, { en: "Total credit", uz: "Jami kredit", ru: "Итого кредит" }), value: control?.credit ?? 0, currency },
        ],
        reportLink: "/accounting/trial-balance",
      };
    }

    case "expenses":
    case "revenue":
    default: {
      const change = percentChange(is.netProfit, is.netProfitPrevious);
      return {
        ...base,
        headline: pick(locale, {
          en: `${ctx.companyName}: ${money(is.revenue.total, currency, locale)} revenue, ${money(is.netProfit, currency, locale)} net profit`,
          uz: `${ctx.companyName}: tushum ${money(is.revenue.total, currency, locale)}, sof foyda ${money(is.netProfit, currency, locale)}`,
          ru: `${ctx.companyName}: выручка ${money(is.revenue.total, currency, locale)}, чистая прибыль ${money(is.netProfit, currency, locale)}`,
        }),
        body: pick(locale, {
          en: `For ${periodLabel}: revenue ${money(is.revenue.total, currency, locale)}, expenses including COGS ${money(is.cogs.total + is.operatingExpenses.total, currency, locale)}, net profit ${money(is.netProfit, currency, locale)}${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs previous period)`}. Cash and bank balances total ${money(cash, currency, locale)}; receivables ${money(Math.abs(ar), currency, locale)}; payables ${money(Math.abs(ap), currency, locale)}. Ask about profit, expenses, debtors, cash, tax or forecast for the details behind these figures.`,
          uz: `${periodLabel}: tushum ${money(is.revenue.total, currency, locale)}, tannarx bilan birga xarajatlar ${money(is.cogs.total + is.operatingExpenses.total, currency, locale)}, sof foyda ${money(is.netProfit, currency, locale)}${change === null ? "" : ` (o'tgan davrga nisbatan ${change >= 0 ? "+" : ""}${change.toFixed(1)}%)`}. Pul mablag'lari ${money(cash, currency, locale)}; debitorlik ${money(Math.abs(ar), currency, locale)}; kreditorlik ${money(Math.abs(ap), currency, locale)}. Batafsil ma'lumot uchun foyda, xarajat, qarzdorlar, pul, soliq yoki prognoz haqida so'rang.`,
          ru: `${periodLabel}: выручка ${money(is.revenue.total, currency, locale)}, расходы с себестоимостью ${money(is.cogs.total + is.operatingExpenses.total, currency, locale)}, чистая прибыль ${money(is.netProfit, currency, locale)}${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change.toFixed(1)}% к предыдущему периоду)`}. Деньги и банк: ${money(cash, currency, locale)}; дебиторка ${money(Math.abs(ar), currency, locale)}; кредиторка ${money(Math.abs(ap), currency, locale)}. Спросите о прибыли, расходах, должниках, деньгах, налогах или прогнозе для деталей.`,
        }),
        figures: [
          { label: pick(locale, { en: "Revenue", uz: "Tushum", ru: "Выручка" }), value: is.revenue.total, currency },
          { label: pick(locale, { en: "Net profit", uz: "Sof foyda", ru: "Чистая прибыль" }), value: is.netProfit, currency },
          { label: pick(locale, { en: "Cash & bank", uz: "Pul mablag'lari", ru: "Деньги и банк" }), value: cash, currency },
        ],
        reportLink: "/reports/profit-loss",
      };
    }
  }
}

function predictCalculation(locale: Locale): string {
  return pick(locale, {
    en: "Figures marked as expected are projections based on your own historic receipts and committed due dates — they are clearly labelled and never presented as actual results.",
    uz: "Kutilayotgan deb belgilangan summalar sizning tarixiy tushumlaringiz va aniq muddatlarga asoslangan prognozdir — ular aniq belgilanadi va hech qachon haqiqiy natija sifatida ko'rsatilmaydi.",
    ru: "Суммы с пометкой «ожидается» — это прогноз на основе ваших исторических поступлений и известных сроков; они явно помечены и никогда не выдаются за фактический результат.",
  });
}

function addMonthsISO(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function averageMonthlyOutflow(companyId: number, months = 3): number {
  const today = todayISO();
  const from = addMonthsISO(today, -months);
  const rows = all<{ month: string; outflow: number }>(
    `SELECT substr(e.date,1,7) AS month,
            COALESCE(SUM(CASE WHEN l.base_credit > l.base_debit THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS outflow
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.subtype IN ('cash','bank') AND e.status = 'posted' AND e.date BETWEEN ? AND ?
      GROUP BY month`,
    [companyId, from, today],
  );
  if (!rows.length) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.outflow, 0) / rows.length);
}

/* ------------------------------------------------------------ cash forecast */
export type ForecastPoint = { date: string; balance: number; inflow: number; outflow: number; label?: string };
export type CashForecast = {
  horizonDays: number;
  startBalance: number;
  endBalance: number;
  minBalance: number;
  minDate: string;
  inflowTotal: number;
  outflowTotal: number;
  points: ForecastPoint[];
  shortages: { date: string; balance: number }[];
  items: { date: string; label: string; amount: number; direction: "in" | "out"; source: string }[];
  assumptions: string[];
};

/** Expected cash flow from committed items plus historic collection behaviour. */
export function cashForecast(companyId: number, horizonDays: number, from?: string): CashForecast {
  const start = from ?? todayISO();
  const end = addDaysISO(start, horizonDays);
  const startBalance = cashBalance(companyId, start);

  const items: CashForecast["items"] = [];

  const invoices = all<{ number: string; customerName: string; dueDate: string; amountDue: number }>(
    `SELECT i.number, c.name AS customerName,
            CASE WHEN i.due_date < ? THEN ? ELSE i.due_date END AS dueDate,
            i.total - i.amount_paid AS amountDue
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE i.company_id = ? AND i.status IN ('sent','partially_paid','overdue') AND i.total > i.amount_paid`,
    [start, start, companyId],
  );
  for (const invoice of invoices) {
    if (invoice.dueDate > end) continue;
    items.push({ date: invoice.dueDate, label: `Invoice ${invoice.number} — ${invoice.customerName}`, amount: invoice.amountDue, direction: "in", source: "invoice" });
  }

  const bills = all<{ number: string; supplierName: string; dueDate: string; amountDue: number }>(
    `SELECT b.number, c.name AS supplierName, CASE WHEN b.due_date < ? THEN ? ELSE b.due_date END AS dueDate,
            b.total - b.amount_paid AS amountDue
       FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE b.company_id = ? AND b.status IN ('open','partially_paid','overdue') AND b.total > b.amount_paid`,
    [start, start, companyId],
  );
  for (const bill of bills) {
    if (bill.dueDate > end) continue;
    items.push({ date: bill.dueDate, label: `Bill ${bill.number} — ${bill.supplierName}`, amount: bill.amountDue, direction: "out", source: "bill" });
  }

  const unpaidExpenses = all<{ number: string; description: string | null; date: string; total: number }>(
    `SELECT number, description, date, amount + tax_amount AS total FROM expenses
      WHERE company_id = ? AND is_paid = 0`,
    [companyId],
  );
  for (const expense of unpaidExpenses) {
    const due = expense.date < start ? start : expense.date;
    if (due > end) continue;
    items.push({ date: due, label: `Unpaid expense ${expense.number}${expense.description ? ` — ${expense.description.slice(0, 40)}` : ""}`, amount: expense.total, direction: "out", source: "expense" });
  }

  // Historic collection behaviour: average monthly receipts over the last 3 months.
  const receipts = all<{ month: string; inflow: number }>(
    `SELECT substr(e.date,1,7) AS month,
            COALESCE(SUM(CASE WHEN l.base_debit > l.base_credit THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS inflow
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.subtype IN ('cash','bank') AND e.status = 'posted' AND e.date BETWEEN ? AND ?
      GROUP BY month`,
    [companyId, addMonthsISO(start, -3), start],
  );
  const avgInflow = receipts.length ? Math.round(receipts.reduce((sum, row) => sum + row.inflow, 0) / receipts.length) : 0;
  if (avgInflow > 0) {
    const months = Math.ceil(horizonDays / 30);
    for (let index = 1; index <= months; index += 1) {
      const date = addMonthsISO(start, index);
      if (date > end) break;
      items.push({
        date,
        label: `Expected collections (average of last ${receipts.length} months)`,
        amount: avgInflow,
        direction: "in",
        source: "expected",
      });
    }
  }

  const lastPayroll = one<{ net_total: number; tax_total: number; social_total: number; period: string }>(
    "SELECT net_total, tax_total, social_total, period FROM payroll_runs WHERE company_id = ? ORDER BY period DESC LIMIT 1",
    [companyId],
  );
  if (lastPayroll) {
    const payrollOutflow = lastPayroll.net_total + lastPayroll.tax_total + lastPayroll.social_total;
    const monthIndex = Number(lastPayroll.period.slice(5, 7));
    const year = Number(lastPayroll.period.slice(0, 4));
    for (let offset = 1; offset <= Math.ceil(horizonDays / 30); offset += 1) {
      const nextMonth = monthIndex + offset > 12 ? 1 : monthIndex + offset;
      const nextYear = monthIndex + offset > 12 ? year + 1 : year;
      const date = `${nextYear}-${String(nextMonth).padStart(2, "0")}-05`;
      if (date < start || date > end) continue;
      items.push({ date, label: "Payroll, taxes and contributions (based on last run)", amount: payrollOutflow, direction: "out", source: "payroll" });
    }
  }

  const obligations = all<{ name: string; dueDate: string; amount: number; paidAmount: number }>(
    `SELECT name, due_date AS dueDate, amount, paid_amount AS paidAmount FROM tax_obligations
      WHERE company_id = ? AND status <> 'paid' AND due_date <= ?`,
    [companyId, end],
  );
  for (const obligation of obligations) {
    const due = obligation.dueDate < start ? start : obligation.dueDate;
    items.push({ date: due, label: obligation.name, amount: Math.max(0, obligation.amount - obligation.paidAmount), direction: "out", source: "tax" });
  }

  const points: ForecastPoint[] = [];
  let balance = startBalance;
  const byDate = new Map<string, ForecastPoint>();
  const cursorDate = start;
  let cursor = cursorDate;
  let guard = 0;
  while (cursor <= end && guard <= horizonDays + 2) {
    const inflow = items.filter((item) => item.date === cursor && item.direction === "in").reduce((sum, item) => sum + item.amount, 0);
    const outflow = items.filter((item) => item.date === cursor && item.direction === "out").reduce((sum, item) => sum + item.amount, 0);
    balance += inflow - outflow;
    const point = { date: cursor, balance, inflow, outflow };
    points.push(point);
    byDate.set(cursor, point);
    cursor = addDaysISO(cursor, 1);
    guard += 1;
  }

  const minPoint = points.reduce((min, point) => (point.balance < min.balance ? point : min), points[0] ?? { date: start, balance: startBalance, inflow: 0, outflow: 0 });
  const shortages = points.filter((point) => point.balance < 0).map((point) => ({ date: point.date, balance: point.balance }));

  return {
    horizonDays,
    startBalance,
    endBalance: balance,
    minBalance: minPoint?.balance ?? startBalance,
    minDate: minPoint?.date ?? start,
    inflowTotal: items.filter((item) => item.direction === "in").reduce((sum, item) => sum + item.amount, 0),
    outflowTotal: items.filter((item) => item.direction === "out").reduce((sum, item) => sum + item.amount, 0),
    points,
    shortages,
    items: items.sort((a, b) => a.date.localeCompare(b.date)),
    assumptions: [
      "Confirmed items: unpaid invoices, unpaid bills, unpaid expenses, tax liabilities with due dates.",
      avgInflow > 0
        ? `Expected collections: average of the last ${receipts.length} month(s) of actual receipts (${avgInflow} minor units per month).`
        : "No expected collections were added because there is not enough receipt history yet.",
      lastPayroll ? "Payroll outflow is based on your most recent payroll run and repeats monthly." : "No payroll outflow is included because no payroll run exists yet.",
      "Projections are clearly separated from actual ledger figures everywhere in BUXAI.",
    ],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...(byDate ? {} : {}),
  };
}

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ health score */
export type HealthFactor = { key: string; label: string; score: number; weight: number; detail: string };
export type HealthScore = {
  score: number;
  band: string;
  factors: HealthFactor[];
  asOf: string;
};

export function financialHealth(companyId: number, period: Period): HealthScore {
  const is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  const cash = cashBalance(companyId, period.to);
  const burn = averageMonthlyOutflow(companyId, 3);
  const ar = Math.abs(accountsReceivable(companyId, period.to));
  const aging = receivablesAging(companyId, period.to);
  const overdue = aging.reduce((sum, row) => sum + row.d1_30 + row.d31_60 + row.d61_90 + row.d90_plus, 0);
  const unreconciled = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM bank_transactions WHERE company_id = ? AND status = 'unmatched'",
    [companyId],
  )?.count ?? 0;
  const openCritical = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM alerts WHERE company_id = ? AND status IN ('open','reviewing') AND severity IN ('high','critical')",
    [companyId],
  )?.count ?? 0;

  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

  const marginScore = clamp(((is.margins.net ?? 0) / 25) * 100);
  const revenueChange = percentChange(is.revenue.total, is.revenue.previousTotal);
  const growthScore = revenueChange === null ? 50 : clamp(50 + revenueChange * 1.5);
  const runwayMonths = burn > 0 ? cash / burn : cash > 0 ? 12 : 0;
  const runwayScore = clamp((runwayMonths / 6) * 100);
  const overdueShare = ar > 0 ? overdue / ar : 0;
  const receivableScore = clamp(100 - overdueShare * 150);
  const expenseChange = percentChange(is.operatingExpenses.total, is.operatingExpenses.previousTotal);
  const disciplineScore =
    expenseChange === null || revenueChange === null ? 60 : clamp(70 + (revenueChange - expenseChange) * 1.2);
  const hygieneScore = clamp(100 - Math.min(unreconciled, 20) * 2.5 - Math.min(openCritical, 6) * 6);

  const factors: HealthFactor[] = [
    { key: "margin", label: `Net margin (${is.margins.net?.toFixed(1) ?? "—"}%)`, score: marginScore, weight: 20, detail: `Net profit ${is.netProfit}` },
    { key: "growth", label: `Revenue growth (${revenueChange === null ? "—" : `${revenueChange.toFixed(1)}%`})`, score: growthScore, weight: 15, detail: "Compared with the previous period" },
    { key: "runway", label: `Cash runway (${runwayMonths.toFixed(1)} months)`, score: runwayScore, weight: 20, detail: "Cash on hand divided by average monthly outflow" },
    { key: "receivables", label: `Receivables risk (${(overdueShare * 100).toFixed(0)}% overdue)`, score: receivableScore, weight: 15, detail: "Overdue share of total receivables" },
    { key: "discipline", label: "Expense discipline", score: disciplineScore, weight: 15, detail: "Expense growth relative to revenue growth" },
    { key: "hygiene", label: `Operational hygiene (${unreconciled} unreconciled lines)`, score: hygieneScore, weight: 15, detail: "Bank reconciliation and open high-severity alerts" },
  ];

  const total = factors.reduce((sum, factor) => sum + (factor.score * factor.weight) / 100, 0);
  const score = Math.round(total);
  const band = score >= 80 ? "Strong" : score >= 65 ? "Stable" : score >= 45 ? "Watch" : "At risk";

  return { score, band, factors, asOf: period.to };
}

/* ------------------------------------------------------------- tax center */
export type TaxOverview = {
  period: { from: string; to: string };
  vat: { output: number; input: number; payable: number; rateBp: number };
  payroll: { incomeTax: number; social: number; total: number };
  profitTax: { estimated: number; rateBp: number; basis: number };
  turnoverTax: { estimated: number; rateBp: number; basis: number };
  totalEstimated: number;
  regime: string;
  calculation: string;
  needsVerification: boolean;
  deadlines: { label: string; dueDate: string; kind: string; note: string }[];
  sources: readonly { label: string; url: string; note: string }[];
};

function movementOnAccount(companyId: number, code: string, from: string, to: string, side: "debit" | "credit"): number {
  const column = side === "debit" ? "l.base_debit" : "l.base_credit";
  const row = one<{ total: number }>(
    `SELECT COALESCE(SUM(${column}), 0) AS total
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.code = ? AND e.status = 'posted' AND e.date BETWEEN ? AND ?`,
    [companyId, code, from, to],
  );
  return row?.total ?? 0;
}

export function taxOverview(companyId: number, period: Period): TaxOverview {
  const company = one<{ tax_regime: string; vat_rate_bp: number; turnover_rate_bp: number; profit_tax_rate_bp: number; social_rate_bp: number; payroll_income_bp: number }>(
    "SELECT tax_regime, vat_rate_bp, turnover_rate_bp, profit_tax_rate_bp, social_rate_bp, payroll_income_bp FROM companies WHERE id = ?",
    [companyId],
  );
  const regime = company?.tax_regime ?? "vat";

  const output = movementOnAccount(companyId, "2031", period.from, period.to, "credit");
  const input = movementOnAccount(companyId, "1400", period.from, period.to, "debit");
  const vatPayable = output - input;

  const payrollIncomeTax = movementOnAccount(companyId, "2033", period.from, period.to, "credit");
  const social = movementOnAccount(companyId, "2034", period.from, period.to, "credit");

  const is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  const profitTaxEstimate = Math.max(0, Math.round((is.netProfit * (company?.profit_tax_rate_bp ?? 1500)) / 10_000));
  const turnoverBase = is.revenue.total;
  const turnoverTaxEstimate = Math.round((turnoverBase * (company?.turnover_rate_bp ?? 400)) / 10_000);

  const payrollTotal = payrollIncomeTax + social;
  const totalEstimated =
    regime === "turnover" ? Math.max(0, turnoverTaxEstimate) + payrollTotal : Math.max(0, vatPayable) + payrollTotal;

  return {
    period: { from: period.from, to: period.to },
    vat: { output, input, payable: vatPayable, rateBp: company?.vat_rate_bp ?? 1200 },
    payroll: { incomeTax: payrollIncomeTax, social, total: payrollTotal },
    profitTax: { estimated: profitTaxEstimate, rateBp: company?.profit_tax_rate_bp ?? 1500, basis: is.netProfit },
    turnoverTax: { estimated: turnoverTaxEstimate, rateBp: company?.turnover_rate_bp ?? 400, basis: turnoverBase },
    totalEstimated,
    regime,
    calculation:
      "VAT = output VAT credited to account 2031 − input VAT debited to account 1400 in the period. Payroll taxes = movements on accounts 2033 and 2034. Profit tax and turnover tax are indicative estimates using the rates configured in Settings → Tax. Amounts come from posted journal entries only.",
    needsVerification: true,
    deadlines: taxDeadlines(companyId),
    sources: TAX_SOURCES,
  };
}

/**
 * Tax calendar. Filing dates differ by tax, regime and entity type, so BUXAI
 * labels every date as a configured assumption and links the official source
 * rather than asserting compliance.
 */
export function taxDeadlines(companyId: number, monthsAhead = 4): TaxOverview["deadlines"] {
  const today = todayISO();
  const rows = all<{ name: string; due_date: string; kind: string; source_note: string | null; amount: number; status: string }>(
    `SELECT name, due_date, kind, source_note, amount, status FROM tax_obligations
      WHERE company_id = ? AND due_date >= ? ORDER BY due_date LIMIT 24`,
    [companyId, today],
  );
  const stored = rows.map((row) => ({
    label: `${row.name}${row.amount ? ` — ${row.amount}` : ""}`,
    dueDate: row.due_date,
    kind: row.kind,
    note: row.source_note ?? "Stored obligation — verify the deadline with the official source.",
  }));

  const generated: TaxOverview["deadlines"] = [];
  for (let index = 0; index < monthsAhead; index += 1) {
    const base = addMonthsISO(today, index);
    const year = Number(base.slice(0, 4));
    const month = Number(base.slice(5, 7));
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const priorMonth = `${month}-${year}`;
    generated.push({
      label: `VAT return for ${priorMonth} (configured assumption: monthly filing)`,
      dueDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-20`,
      kind: "vat",
      note: "Filing frequency and day depend on your regime and turnover. Verify with the Tax Committee or your tax adviser before relying on this date.",
    });
    generated.push({
      label: `Payroll and social contribution payments for ${priorMonth}`,
      dueDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-15`,
      kind: "payroll",
      note: "Withholding and contribution deadlines depend on payroll dates and payer category — verify with the official source.",
    });
  }
  void monthsAhead;
  return [...stored, ...generated].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 14);
}

export function defaultPeriod(companyId: number, locale: Locale = "en"): Period {
  const first = one<{ date: string }>(
    "SELECT MIN(e.date) AS date FROM journal_entries e WHERE e.company_id = ? AND e.status = 'posted'",
    [companyId],
  )?.date;
  return resolvePeriod("this_month", { locale, firstDataDate: first ?? undefined });
}

export function periodFromParams(
  companyId: number,
  params: { preset?: string; from?: string; to?: string },
  locale: Locale = "en",
): Period {
  const first = one<{ date: string }>(
    "SELECT MIN(e.date) AS date FROM journal_entries e WHERE e.company_id = ? AND e.status = 'posted'",
    [companyId],
  )?.date;
  const preset = (params.preset ?? "this_month") as Parameters<typeof resolvePeriod>[0];
  return resolvePeriod(preset, { from: params.from, to: params.to, locale, firstDataDate: first ?? undefined });
}

export function monthlyBreakdownFor(companyId: number, period: Period) {
  return monthlySeries(companyId, period.from, period.to);
}

export function yearToDateCashFlow(companyId: number, asOf = todayISO()) {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  return cashFlowStatement(companyId, yearStart, asOf);
}

export { monthRange, monthKey };
