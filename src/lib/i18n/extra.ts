/**
 * UI-layer translations added while building the interface.
 *
 * Kept in a separate table so the core accounting dictionary stays reviewable
 * on its own; merged into `TRIPLES` at load time (see `dictionary.ts`).
 * Triples are [English, Uzbek, Russian] — always all three.
 */
import type { Triple } from "./dictionary";

export const EXTRA_TRIPLES: Record<string, Triple> = {
  /* ---------------------------------------------------------------- brand */
  "brand.companies": ["Companies", "Kompaniyalar", "Компании"],
  "brand.demoData": ["Demo data", "Demo ma'lumotlar", "Демо-данные"],
  "brand.demoCompany": ["demo company", "demo kompaniya", "демо-компания"],

  /* ---------------------------------------------------------------- period */
  "acc.preset_this_month": ["This month", "Bu oy", "Этот месяц"],
  "acc.preset_last_month": ["Last month", "O'tgan oy", "Прошлый месяц"],
  "acc.preset_this_quarter": ["This quarter", "Bu chorak", "Этот квартал"],
  "acc.preset_last_quarter": ["Last quarter", "O'tgan chorak", "Прошлый квартал"],
  "acc.preset_this_year": ["This year", "Bu yil", "Этот год"],
  "acc.preset_last_year": ["Last year", "O'tgan yil", "Прошлый год"],
  "acc.preset_ytd": ["Year to date", "Yil boshidan", "С начала года"],
  "acc.preset_last_30_days": ["Last 30 days", "Oxirgi 30 kun", "Последние 30 дней"],
  "acc.preset_last_90_days": ["Last 90 days", "Oxirgi 90 kun", "Последние 90 дней"],
  "acc.preset_all_time": ["All time", "Butun davr", "Всё время"],
  "acc.preset_custom": ["Custom range", "Maxsus davr", "Свой период"],
  "acc.customRange": ["Custom date range", "Maxsus sana oralig'i", "Свой диапазон дат"],

  /* ---------------------------------------------------------------- search */
  "search.paletteHint": ["Search pages, invoices, contacts, documents…", "Sahifa, hisob-faktura, kontragent qidirish…", "Поиск страниц, счетов, контрагентов…"],
  "search.quickActions": ["Quick actions", "Tezkor amallar", "Быстрые действия"],
  "search.records": ["Records", "Yozuvlar", "Записи"],
  "search.navigate": ["navigate", "harakat", "навигация"],
  "search.hintMin": ["Type at least 2 characters to search records", "Yozuvlarni qidirish uchun kamida 2 ta belgi kiriting", "Введите минимум 2 символа для поиска"],
  "search.noResults": ["Nothing found", "Hech narsa topilmadi", "Ничего не найдено"],

  /* ------------------------------------------------------------ navigation */
  /* --------------------------------------------------------- forms & lists */
  "common.addLine": ["Add line", "Qator qo'shish", "Добавить строку"],
  "sales.lines": ["Line items", "Qatorlar", "Позиции"],
  "sales.freeTextLine": ["— free text line —", "— erkin matnli qator —", "— свободная строка —"],
  "sales.lineDescriptionPlaceholder": ["Service or goods description", "Xizmat yoki tovar tavsifi", "Описание услуги или товара"],
  "sales.notesPlaceholder": ["Notes visible on the invoice", "Hisob-fakturada ko'rinadigan izoh", "Заметки в счёте"],
  "sales.terms": ["Payment terms", "To'lov shartlari", "Условия оплаты"],
  "sales.termsPlaceholder": ["Payment within 14 days", "14 kun ichida to'lov", "Оплата в течение 14 дней"],
  "sales.sendImmediately": ["Send to the ledger now", "Hoziroq provodka qilish", "Провести сразу"],
  "sales.sendImmediatelyHint": ["Creates the receivable, revenue and VAT entries immediately.", "Debitorlik, tushum va QQS provodkalarini darhol yaratadi.", "Сразу создаёт проводки по дебиторке, выручке и НДС."],
  "sales.saveAndSend": ["Save and post to the ledger", "Saqlash va provodka qilish", "Сохранить и провести"],
  "sales.saveAndSendHint": ["Draft invoices can still be edited afterwards.", "Qoralama hisob-fakturani keyin ham tahrirlash mumkin.", "Черновик можно отредактировать позже."],
  "sales.createInvoice": ["Create invoice", "Hisob-faktura yaratish", "Создать счёт"],
  "sales.warehouseHint": ["Stock-tracked goods lines are deducted from this warehouse.", "Ombordagi tovarlar shu omborga bog'lanadi.", "Товарные позиции списываются с этого склада."],

  /* ------------------------------------------------------------------ sales */
  "sales.invoices": ["Invoices", "Hisob-fakturalar", "Счета"],
  "sales.invoicesSubtitle": ["Every issued invoice with its payment status, traced to the general ledger.", "Har bir hisob-faktura va to'lov holati, bosh kitobga bog'langan.", "Каждый счёт с его статусом оплаты и связью с главной книгой."],
  "sales.invoiced": ["Invoiced (all time)", "Hisob-fakturalangan", "Выставлено"],
  "sales.collected": ["Collected", "Yig'ilgan", "Оплачено"],
  "sales.outstanding": ["Outstanding", "Qoldiq", "К получению"],
  "sales.overdue": ["Overdue", "Muddati o'tgan", "Просрочено"],
  "sales.collectionRate": ["collection rate", "yig'ilish darajasi", "собираемость"],
  "sales.amountDue": ["Amount due", "To'lanadigan", "К оплате"],
  "sales.invoice": ["Invoice", "Hisob-faktura", "Счёт"],
  "sales.allCustomers": ["All customers", "Barcha mijozlar", "Все клиенты"],
  "sales.noInvoices": ["No invoices yet", "Hozircha hisob-fakturalar yo'q", "Счетов пока нет"],
  "sales.noInvoicesHint": ["Issue your first invoice — it posts revenue, VAT and the receivable in one balanced entry.", "Birinchi hisob-fakturani yarating — u tushum, QQS va debitorlikni bitta balanslangan provodkada aks ettiradi.", "Выставьте первый счёт — он создаст выручку, НДС и дебиторку одной сбалансированной проводкой."],

  "sales.issued": ["issued", "berilgan", "выставлен"],
  "sales.invoiceBody": ["Invoice lines", "Hisob-faktura qatorlari", "Позиции счёта"],
  "sales.noAccount": ["no revenue account", "tushum hisobi yo'q", "счёт выручки не указан"],
  "sales.paidAmount": ["Paid", "To'langan", "Оплачено"],
  "sales.payments": ["Payments", "To'lovlar", "Платежи"],
  "sales.noPayments": ["No payment has been recorded against this invoice yet.", "Bu hisob-faktura bo'yicha hali to'lov qayd etilmagan.", "По этому счёту пока нет платежей."],
  "sales.ledgerTrace": ["Ledger trace", "Bosh kitob izi", "Связь с главной книгой"],
  "sales.ledgerTraceHint": ["The exact entry this invoice produced.", "Ushbu hisob-faktura yaratgan aniq provodka.", "Проводка, созданная этим счётом."],
  "sales.journalEntry": ["Journal entry", "Provodka", "Проводка"],
  "sales.notPostedYet": ["This invoice has not been posted to the ledger yet.", "Bu hisob-faktura hali bosh kitobga o'tkazilmagan.", "Счёт ещё не проведён в главной книге."],
  "sales.postToLedger": ["Post to ledger", "Provodka qilish", "Провести"],
  "sales.recordPayment": ["Record payment", "To'lovni qayd etish", "Записать платёж"],
  "sales.paymentHint": ["Outstanding amount: {amount}", "To'lanadigan summa: {amount}", "К оплате: {amount}"],
  "sales.paymentLedgerHint": ["Paid so far {paid} of {total}. The ledger entry reduces receivables by exactly the amount received.", "Hozircha {total} dan {paid} to'langan. Provodka debitorlikni aynan olingan summa miqdorida kamaytiradi.", "Оплачено {paid} из {total}. Проводка уменьшит дебиторку ровно на полученную сумму."],
  "sales.paymentRecorded": ["Payment recorded", "To'lov qayd etildi", "Платёж записан"],
  "sales.paymentRecordedHint": ["Receivables decreased and the bank account increased in the same balanced entry.", "Debitorlik kamaydi va bank hisobi xuddi shu balanslangan provodkada oshdi.", "Дебиторка уменьшилась, банковский счёт вырос одной сбалансированной проводкой."],
  "sales.invoicePosted": ["Invoice posted to the ledger", "Hisob-faktura provodka qilindi", "Счёт проведён в главной книге"],
  "sales.invoiceDuplicated": ["Draft copy created", "Qoralama nusxa yaratildi", "Создана копия-черновик"],
  "sales.invoiceCancelled": ["Invoice cancelled", "Hisob-faktura bekor qilindi", "Счёт отменён"],
  "sales.cancelInvoice": ["Cancel invoice", "Hisob-fakturani bekor qilish", "Отменить счёт"],
  "sales.cancelInvoiceHint": ["The posting is reversed with a counter-entry — nothing is deleted, so the ledger stays auditable.", "Provodka teskari yozuv bilan qaytariladi — hech narsa o'chirilmaydi, jurnal tekshiriladigan bo'lib qoladi.", "Проводка сторнируется обратной записью — ничего не удаляется, журнал остаётся проверяемым."],
  "sales.createInvoiceHint": ["Revenue, VAT and the receivable are posted in one balanced entry when you save.", "Saqlaganda tushum, QQS va debitorlik bitta balanslangan provodkada aks etadi.", "При сохранении выручка, НДС и дебиторка проводятся одной сбалансированной записью."],

  "sales.editHint": ["Editing an issued invoice reverses the old posting and creates a new balanced one.", "Hisob-fakturani tahrirlash eski provodkani qaytarib, yangisini yaratadi.", "Редактирование счёта сторнирует старую проводку и создаёт новую."],
  "sales.editPostedHint": ["Current total on the ledger:", "Jurnaldagi joriy summa:", "Текущая сумма в книге:"],

  /* ------------------------------------------------------- settings labels */
  "settings.taxId": ["Tax ID", "STIR", "ИНН"],
  "settings.address": ["Address", "Manzil", "Адрес"],
  "settings.email": ["Email", "Elektron pochta", "Электронная почта"],
  "settings.phone": ["Phone", "Telefon", "Телефон"],

  /* ------------------------------------------------------------- banking UI */
  "bank.account": ["Account", "Hisob", "Счёт"],
  "bank.method": ["Payment method", "To'lov usuli", "Способ оплаты"],
  "bank.methodBank": ["Bank transfer", "Bank o'tkazmasi", "Банковский перевод"],
  "bank.methodCash": ["Cash", "Naqd", "Наличные"],
  "bank.methodCard": ["Card", "Plastik karta", "Карта"],
  "inv.noStockImpact": ["No stock impact (services and free text lines)", "Ombor qoldig'iga ta'sir qilmaydi (xizmatlar)", "Без влияния на склад (услуги)"],

  /* ------------------------------------------------------------ table UI */
  "common.columns": ["Columns", "Ustunlar", "Колонки"],
  "common.filtered": ["Filtered", "Filtrlangan", "Отфильтровано"],
  "common.filtersSaved": ["Saved filters", "Saqlangan filtrlar", "Сохранённые фильтры"],
  "common.saveFilter": ["Save filter", "Filtrni saqlash", "Сохранить фильтр"],
  "common.filterName": ["Filter name", "Filtr nomi", "Название фильтра"],

  /* -------------------------------------------------------------- accounts */
  "notif.notifications": ["Notifications", "Bildirishnomalar", "Уведомления"],
  "team.newCompany": ["Add another company", "Yana kompaniya qo'shish", "Добавить компанию"],

  /* ------------------------------------------------------- dashboard extra */
  "dash.forecastSeries": ["Projected cash", "Prognoz qilingan naqd", "Прогноз остатка"],
  "dash.ledgerSource": ["figures read straight from the general ledger", "bosh kitobdan olingan ko'rsatkichlar", "показатели из главной книги"],
  "dash.noComparison": ["no comparison period", "taqqoslash davri yo'q", "нет периода сравнения"],
  "dash.noData": ["No data for this period", "Bu davr uchun ma'lumot yo'q", "Нет данных за период"],
  "dash.noDataHint": ["Post an invoice, expense or bank transaction and it appears here instantly.", "Hisob-faktura, xarajat yoki bank operatsiyasini kiriting — darhol shu yerda ko'rinadi.", "Проведите счёт, расход или банковскую операцию — они появятся здесь."],
  "dash.noExpenses": ["No expenses recorded", "Xarajatlar qayd etilmagan", "Расходов нет"],
  "dash.noExpensesHint": ["Expenses you record are grouped by category here.", "Kiritilgan xarajatlar bu yerda toifalar bo'yicha guruhlanadi.", "Внесённые расходы группируются здесь по категориям."],
  "dash.noForecast": ["Forecast not available", "Prognoz mavjud emas", "Прогноз недоступен"],
  "dash.noForecastHint": ["A forecast appears once there are committed invoices, bills or expenses.", "Prognoz tasdiqlangan hisob-fakturalar, majburiyatlar yoki xarajatlar paydo bo'lganda ko'rinadi.", "Прогноз появится при наличии счетов, обязательств или расходов."],
  "dash.shortageWarning": [
    "{count} projected cash shortfall(s); lowest balance {balance} on {date}.",
    "{count} marta pul yetishmovchiligi kutilmoqda; eng past qoldiq {balance} ({date}).",
    "Прогнозируется нехватка денег {count} раз; минимальный остаток {balance} ({date}).",
  ],
  "dash.openCfo": ["AI CFO analysis", "AI CFO tahlili", "Анализ AI CFO"],
  "dash.inflow90": ["Expected inflow (90d)", "Kutilayotgan kirim (90 kun)", "Ожидаемый приток (90 дн)"],
  "dash.outflow90": ["Expected outflow (90d)", "Kutilayotgan chiqim (90 kun)", "Ожидаемый отток (90 дн)"],
  "dash.xatoSummary": ["{count} open findings · {critical} critical", "{count} ochiq ogohlantirish · {critical} jiddiy", "{count} открытых замечаний · {critical} критичных"],
  "dash.noRecentHint": ["The ledger is empty for this company.", "Bu kompaniya uchun jurnal bo'sh.", "Журнал этой компании пуст."],
  "dash.noLowStock": ["Stock levels are healthy", "Qoldiqlar yetarli", "Остатки в норме"],
  "dash.noLowStockHint": ["No product is at or below its minimum stock level.", "Hech bir mahsulot minimal qoldiq darajasida emas.", "Ни один товар не достиг минимального остатка."],
  "dash.entriesChecked": ["Journal entries checked by the integrity test", "Yaxlitlik testi tekshirgan yozuvlar", "Проводок проверено тестом целостности"],
  "dash.integrityFail": ["Imbalance of {amount} detected — reports may be wrong.", "Balanssizlik aniqlandi: {amount} — hisobotlar xato bo'lishi mumkin.", "Обнаружен дисбаланс {amount} — отчёты могут быть неверны."],

  /* ------------------------------------------------------------- shared UI */
  "common.dueDate": ["Due date", "To'lov muddati", "Срок оплаты"],
  "sales.overdueDays": ["{days} days overdue", "{days} kun kechikdi", "просрочено {days} дн"],
  "rep.agingCurrent": ["Current", "Joriy", "Текущие"],
  "rep.aging1_30": ["1–30 days", "1–30 kun", "1–30 дней"],
  "rep.aging31_60": ["31–60 days", "31–60 kun", "31–60 дней"],
  "rep.aging61_90": ["61–90 days", "61–90 kun", "61–90 дней"],
  "rep.aging90Plus": ["90+ days", "90+ kun", "90+ дней"],
  "gl.debitShort": ["Dr", "Debet", "Дт"],
  "gl.creditShort": ["Cr", "Kredit", "Кт"],
  "inv.min": ["min", "min", "мин"],

  /* ------------------------------------------------------------- dashboard */
  "dash.demoBanner": [
    "You are viewing a demo company. Its data is clearly labelled and kept completely separate from any company you create.",
    "Siz demo kompaniyani ko'rmoqdasiz. Uning ma'lumotlari aniq belgilangan va siz yaratgan kompaniyalardan to'liq ajratilgan.",
    "Вы просматриваете демо-компанию. Её данные помечены и полностью отделены от созданных вами компаний.",
  ],
  "dash.integrityOk": ["Ledger integrity verified — total debits equal total credits.", "Buxgalteriya balansi tekshirildi — debet va kredit teng.", "Целостность учёта подтверждена — дебет равен кредиту."],
  "dash.healthFactors": ["Health factors", "Salomatlik omillari", "Факторы оценки"],
  "dash.lowStock": ["Low stock", "Kam qoldiq", "Низкий остаток"],
  "dash.lowStockHint": ["Products at or below their minimum stock level.", "Mahsulotlar minimal qoldiq darajasida yoki undan past.", "Товары на минимальном уровне остатка или ниже."],
  "dash.agingHint": ["Receivables by how long they have been outstanding.", "Debitorlik qarzlari muddati bo'yicha.", "Дебиторская задолженность по срокам."],
  "dash.forecastHint": ["Expected cash movement over the next 90 days from committed invoices, bills, expenses and payroll.", "Kelgusi 90 kun uchun kutilayotgan pul harakati: hisob-fakturalar, ta'minotchi hisoblari, xarajatlar va ish haqi.", "Ожидаемое движение денег на 90 дней: счета, обязательства, расходы и зарплата."],
  "dash.noInvoices": ["No unpaid invoices", "To'lanmagan hisob-fakturalar yo'q", "Нет неоплаченных счетов"],
  "dash.noInvoicesHint": ["Every issued invoice has been settled.", "Barcha hisob-fakturalar to'langan.", "Все выставленные счета оплачены."],
  "dash.noUpcoming": ["No upcoming payments", "Kelgusi to'lovlar yo'q", "Предстоящих платежей нет"],
  "dash.noRecent": ["No transactions yet", "Hozircha operatsiyalar yo'q", "Пока нет операций"],
  "dash.prevPeriod": ["vs {period}", "o'tgan davrga nisbatan", "к {period}"],
  "dash.shortcuts": ["Shortcuts", "Tezkor tugmalar", "Горячие клавиши"],
  "dash.toReconcile": ["To reconcile", "Solíshtirish kerak", "К сверке"],
};
