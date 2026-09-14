/**
 * Seeds the demo workspace.
 *
 * Everything created here is flagged `is_demo = 1` (company and user) so the
 * product can label it clearly and keep it apart from real customer data.
 * The dataset is posted through the ordinary services — the same code path a
 * user's own data takes — so the demo can never contain numbers the accounting
 * engine would refuse.
 *
 *   npm run seed
 */
/*
 * Loaded with dynamic `import()`: the app modules are TypeScript with path
 * aliases, and tsx only exposes their named exports through the dynamic form.
 */
const { all, closeDb, insert, nowISO, one, run } = await import("@/lib/db");
const { createCompany } = await import("@/lib/services/company");
const { hashPassword } = await import("@/lib/auth/session");
const { createContact } = await import("@/lib/services/contacts");
const { createInvoice, recordInvoicePayment, refreshOverdueInvoices, sendInvoice } = await import("@/lib/services/sales");
const { createBill, createExpense, recordBillPayment } = await import("@/lib/services/purchases");
const { createProduct, recordStockMove, transferStock } = await import("@/lib/services/inventory");
const { createAdvance, createEmployee, createPayrollRun, payPayrollRun } = await import("@/lib/services/payroll");
const { commitStatementImport } = await import("@/lib/services/banking");
const { uploadDocument } = await import("@/lib/services/documents");
const { createBudget, createTask, generateNotifications, generateTasks, runXatoRadar } = await import("@/lib/services/operations");
const { addDays, addMonths, monthRange, resolvePeriod, startOfMonth, todayISO } = await import("@/lib/dates");
const { postEntry } = await import("@/lib/accounting/engine");

const DEMO_EMAIL = "demo@buxai.app";
const DEMO_PASSWORD = "demo1234";
const COMPANY_NAME = "Zamin Logistics MChJ";
const BASE = "UZS";
/*
 * UZS has no subunit in day-to-day use, so one so'm is one minor unit (see
 * CURRENCY_META). M() therefore converts "millions of so'm" into minor units
 * without any extra scaling.
 */
const M = (millions: number) => Math.round(millions * 1_000_000);
/** Plain so'm, in minor units — per-unit prices like fuel, storage, repairs. */
const S = (sum: number) => Math.round(sum);
const TODAY = todayISO();
const START = startOfMonth(addMonths(TODAY, -5));

console.log("BUXAI demo seed\n");

/* Existing demo workspace? Replace it so the seed is idempotent. */
const existing = one<{ id: number }>("SELECT id FROM companies WHERE is_demo = 1 LIMIT 1");
if (existing) {
  console.log("  removing the previous demo workspace…");
  run("DELETE FROM companies WHERE id = ?", [existing.id]);
  run("DELETE FROM users WHERE is_demo = 1");
}

const { hash, salt } = hashPassword(DEMO_PASSWORD);
const userId = insert(
  "INSERT INTO users (email, name, password_hash, password_salt, locale, theme, is_demo, created_at) VALUES (?, ?, ?, ?, 'uz', 'light', 1, ?)",
  [DEMO_EMAIL, "Dilnoza Karimova", hash, salt, nowISO()],
);

const companyId = createCompany({
  name: COMPANY_NAME,
  legalName: "Zamin Logistics MChJ",
  taxId: "305123456",
  vatNumber: "305123456",
  address: "Toshkent sh., Mirzo Ulug'bek tumani, Amir Temur shoh ko'chasi 108",
  directorName: "Dilnoza Karimova",
  chiefAccountantName: "Sardor Yo'ldoshev",
  phone: "+998 71 200 45 45",
  email: "info@zamin-logistics.uz",
  industry: "Logistics & freight",
  baseCurrency: BASE,
  taxRegime: "vat",
  invoicePrefix: "INV",
  isDemo: true,
  locale: "uz",
  userId,
  role: "owner",
});
const ctx = { userId, userName: "Dilnoza Karimova" };
console.log(`  demo company #${companyId} created`);

/* ------------------------------------------------------------ reference data */
const accounts = Object.fromEntries(
  all<{ id: number; code: string }>("SELECT id, code FROM accounts WHERE company_id = ?", [companyId]).map((account) => [account.code, account.id]),
) as Record<string, number>;

const categories = Object.fromEntries(
  all<{ id: number; name: string }>("SELECT id, name FROM categories WHERE company_id = ?", [companyId]).map((category) => [category.name, category.id]),
) as Record<string, number>;

const departments = all<{ id: number; name: string }>("SELECT id, name FROM departments WHERE company_id = ?", [companyId]);
const warehouse = one<{ id: number; name: string }>("SELECT id, name FROM warehouses WHERE company_id = ? ORDER BY id LIMIT 1", [companyId])!;
const secondWarehouse = insert("INSERT INTO warehouses (company_id, name, code, address, is_default, created_at) VALUES (?, ?, ?, ?, 0, ?)", [
  companyId,
  "Viloyat ombori — Buxoro",
  "WH-02",
  "Buxoro sh., Sanoat zonasi 4",
  nowISO(),
]);
const bank = one<{ id: number; account_id: number; name: string }>(
  "SELECT id, account_id, name FROM bank_accounts WHERE company_id = ? AND kind = 'bank' ORDER BY id LIMIT 1",
  [companyId],
)!;
const cash = one<{ id: number; account_id: number }>("SELECT id, account_id FROM bank_accounts WHERE company_id = ? AND kind = 'cash' ORDER BY id LIMIT 1", [companyId])!;
const cashAccountId = accountId("1010");
void cashAccountId;

const customers = [
  ["UzAuto Motors AJ", "301987654", "Toshkent"],
  ["Silk Road Trading LLC", "302456789", "Toshkent"],
  ["Buxoro Textile Group", "303112233", "Buxoro"],
  ["Samarqand Agro Servis", "304778899", "Samarqand"],
  ["Navoiy Metall Kompani", "305223344", "Navoiy"],
  ["Fergana Fresh Foods MChJ", "306334455", "Farg'ona"],
  ["Qarshi Neft Servis", "307445566", "Qashqadaryo"],
  ["Amudaryo Construction", "308556677", "Urganch"],
].map(([name, taxId, city]) =>
  createContact({
    companyId,
    kind: "customer",
    name,
    legalName: name,
    taxId,
    contactPerson: "Mijoz vakili",
    phone: "+998 90 123 45 67",
    email: `sales@${String(name).toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)}.uz`,
    address: `${city}, Uzbekistan`,
    currency: BASE,
    paymentTermsDays: 14,
    creditLimit: M(500),
  }),
);

const supplierNames: string[] = [];
const suppliers = [
  ["Toshkent Yonilg'i Ta'minot", "309667788", "Diesel va motor moylari"],
  ["Avto Servis Center MChJ", "310778899", "Texnik xizmat"],
  ["UzbekTelecom MChJ", "311889900", "Aloqa va internet"],
  ["Elektr Tarmoqlari AJ", "312990011", "Elektr energiya"],
  ["Ofis Plus Savdo", "313001122", "Kanselyariya va jihozlar"],
  ["Xavfsiz Yo'l Sug'urta", "314112233", "Transport sug'urtasi"],
].map(([name, taxId, note]) => {
  supplierNames.push(String(name));
  return createContact({
    companyId,
    kind: "supplier",
    name,
    legalName: name,
    taxId,
    contactPerson: "Yetkazib beruvchi",
    phone: "+998 71 200 11 22",
    address: "Toshkent, Uzbekistan",
    currency: BASE,
    paymentTermsDays: 10,
    notes: note,
  });
});
const supplierByName = Object.fromEntries(suppliers.map((id, index) => [supplierNames[index], id])) as Record<string, number>;

const products = [
  /* Services sold per trip / per month. */
  ["Logistik xizmat — Toshkent–Moskva", "service", 0, M(42), "trip", 0],
  ["Logistik xizmat — ichki yo'nalish", "service", 0, M(12.5), "trip", 0],
  ["Ombor saqlash (oylik)", "service", 0, S(45_000), "m²", 0],
  /* Spare parts and consumables kept in stock. */
  ["Dizel yonilg'i", "goods", S(11_000), S(12_000), "l", 4_000_000],
  ["Motor moyi 5W-40", "goods", S(120_000), S(145_000), "l", 600_000],
  ["Yuk avtomobili shinasi R22.5", "goods", M(4.8), M(6.4), "pcs", 40_000],
  ["Tormoz kolodkasi to'plami", "goods", S(1_100_000), S(1_600_000), "set", 120_000],
  ["GPS kuzatuv moduli", "goods", S(230_000), S(320_000), "pcs", 25_000],
  ["Muzlatgich termograf", "goods", S(850_000), S(1_400_000), "pcs", 30_000],
  ["Sklad tokchasi (metall)", "goods", M(3.6), M(5.2), "pcs", 80_000],
].map(([name, type, purchasePrice, sellingPrice, unit, minStock]) =>
  createProduct({
    companyId,
    name: String(name),
    type: type as "goods" | "service",
    unit: String(unit),
    purchasePrice: Number(purchasePrice),
    sellingPrice: Number(sellingPrice),
    minStockMilli: Number(minStock),
    description: type === "service" ? "Xizmat ko'rsatish pozitsiyasi" : "Savdo va ta'mirlash uchun tovar",
  }),
);

const employees = [
  ["Sardor Yo'ldoshev", "Bosh buxgalter", 1, M(14)],
  ["Aziz Rahimov", "Logistika menejeri", 2, M(11)],
  ["Kamola Yusupova", "Savdo menejeri", 2, M(10)],
  ["Jasur Toshmatov", "Haydovchi", 3, M(7.5)],
  ["Rustam Ergashev", "Haydovchi", 3, M(7.5)],
  ["Nilufar Saidova", "Omborchi", 3, M(6.5)],
  ["Bekzod Umarov", "Servis ustasi", 3, M(8)],
  ["Zulfiya Nazarova", "Kadrlar bo'limi", 1, M(9)],
].map(([fullName, position, departmentIndex, grossSalary]) =>
  createEmployee(
    {
      companyId,
      fullName: String(fullName),
      position: String(position),
      departmentId: departments[Number(departmentIndex) - 1]?.id ?? null,
      hireDate: addMonths(TODAY, -18),
      grossSalary: Number(grossSalary),
      currency: BASE,
      taxId: `3${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
      inpsNumber: `INPS-${String(Math.floor(Math.random() * 900_000) + 100_000)}`,
      bankAccount: `8600 ${Math.floor(Math.random() * 9000) + 1000} 0000`,
      phone: "+998 90 555 44 33",
    },
    ctx,
  ),
);

/* Deterministic pseudo-random generator keeps the demo stable between runs. */
let seedValue = 20260914;
const rand = () => {
  seedValue = (seedValue * 1103515245 + 12345) % 2147483648;
  return seedValue / 2147483648;
};
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

/* Every account code used below must exist in this company's chart of accounts. */
function accountId(code: string): number {
  const id = accounts[code];
  if (!id) throw new Error(`Chart of accounts is missing account ${code}`);
  return id;
}

/* ------------------------------------------------------------ opening capital */
postEntry({
  companyId,
  date: addDays(START, -3),
  memo: "Ustav kapitali — ta'sischilar hissasi",
  sourceType: "opening",
  userId,
  lines: [
    { accountId: accountId("1021"), debit: M(1500), description: "Bankdagi ustav kapitali" },
    { accountId: accountId("3010"), credit: M(1200), description: "Ustav kapitali" },
    { accountId: accountId("3020"), credit: M(300), description: "Ta'sischilar qarzi" },
  ],
});
postEntry({
  companyId,
  date: addDays(START, -2),
  memo: "Bank krediti — aylanma mablag'lar",
  sourceType: "manual",
  userId,
  lines: [
    { accountId: accountId("1021"), debit: M(800), description: "Kredit tushumi" },
    { accountId: accountId("2051"), credit: M(800), description: "Uzoq muddatli bank krediti" },
  ],
});
postEntry({
  companyId,
  date: addDays(START, -2),
  memo: "Boshlang'ich tovar zaxirasi va kassa qoldig'i",
  sourceType: "opening",
  userId,
  lines: [
    { accountId: accountId("1010"), debit: M(120), description: "Kassadagi naqd" },
    { accountId: accountId("3030"), credit: M(120), description: "Boshlang'ich qoldiq manbasi" },
  ],
});
postEntry({
  companyId,
  date: addDays(START, -2),
  memo: "O'tgan davr taqsimlanmagan foydasi",
  sourceType: "opening",
  userId,
  lines: [
    { accountId: accountId("1021"), debit: M(240), description: "Taqsimlanmagan foyda" },
    { accountId: accountId("3030"), credit: M(240), description: "Taqsimlanmagan foyda" },
  ],
});

/* ------------------------------------------------------------------- trading */
const months = monthRange(START, TODAY);
let invoiceCount = 0;
let billCount = 0;
let expenseCount = 0;
const paidInvoiceIds: { id: number; amount: number }[] = [];
const openInvoiceIds: number[] = [];

for (const [index, month] of months.entries()) {
  const monthStart = `${month}-01`;
  const daysToUse = index === months.length - 1 ? Math.max(1, new Date(TODAY).getUTCDate() - 1) : 20;
  const invoiceTarget = int(13, 18);

  for (let i = 0; i < invoiceTarget; i += 1) {
    const day = Math.min(daysToUse, int(1, 26));
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const customerId = pick(customers);
    const lineCount = int(1, 3);
    const lines = Array.from({ length: lineCount }, () => {
      /* Two thirds of the revenue comes from freight services, the rest from
         storage and spare parts — the same mix the company actually bills. */
      const productIndex = rand() < 0.66 ? int(0, 2) : int(3, products.length - 1);
      const product = products[productIndex];
      const info = one<{ selling_price: number; name: string; unit: string }>("SELECT selling_price, name, unit FROM products WHERE id = ?", [product]);
      return {
        productId: product,
        description: info?.name ?? "Xizmat",
        qtyMilli: info?.unit === "m²" ? int(120, 600) * 1000 : int(1, 5) * 1000,
        unitPrice: info?.selling_price ?? M(1),
        taxRateBp: 1200,
        warehouseId: warehouse.id,
      };
    });
    const invoiceId = createInvoice(
      { companyId, contactId: customerId, issueDate: date, dueDate: addDays(date, 14), currency: BASE, lines, terms: "To'lov 14 kun ichida", warehouseId: warehouse.id },
      ctx,
    );
    sendInvoice(companyId, invoiceId, ctx);
    invoiceCount += 1;

    const total = one<{ total: number }>("SELECT total FROM invoices WHERE id = ?", [invoiceId])?.total ?? 0;
    const roll = rand();
    if (index < months.length - 1 && roll < 0.78) {
      recordInvoicePayment({ companyId, invoiceId, amount: total, date: addDays(date, int(5, 30)), bankAccountId: bank.id, reference: `PMT-${invoiceId}` }, ctx);
      paidInvoiceIds.push({ id: invoiceId, amount: total });
    } else if (roll < 0.88) {
      recordInvoicePayment({ companyId, invoiceId, amount: Math.round(total * 0.4), date: addDays(date, int(3, 12)), bankAccountId: bank.id, reference: `PMT-${invoiceId}` }, ctx);
      openInvoiceIds.push(invoiceId);
    } else {
      openInvoiceIds.push(invoiceId);
    }
  }

  for (let i = 0; i < int(3, 5); i += 1) {
    const date = `${month}-${String(int(1, 26)).padStart(2, "0")}`;
    const productId = products[int(3, products.length - 1)];
    const product = one<{ purchase_price: number; name: string; unit: string }>("SELECT purchase_price, name, unit FROM products WHERE id = ?", [productId])!;
    const qtyMilli =
      product.unit === "l" ? int(4_000, 12_000) * 1000 : product.unit === "pcs" || product.unit === "set" ? int(4, 24) * 1000 : int(20, 80) * 1000;
    const billId = createBill(
      {
        companyId,
        contactId: pick(suppliers),
        issueDate: date,
        dueDate: addDays(date, 10),
        currency: BASE,
        lines: [{ productId, description: product.name, qtyMilli, unitPrice: product.purchase_price, taxRateBp: 1200, warehouseId: warehouse.id }],
        postImmediately: true,
        warehouseId: warehouse.id,
      },
      ctx,
    );
    billCount += 1;
    const total = one<{ total: number }>("SELECT total FROM bills WHERE id = ?", [billId])?.total ?? 0;
    if (index < months.length - 1 && rand() < 0.85) {
      recordBillPayment({ companyId, billId, amount: total, date: addDays(date, int(4, 20)), bankAccountId: bank.id }, ctx);
    }
  }

  /* Monthly operating costs of the fleet and the office, in millions of so'm. */
  const expensePlan: [string, string, number][] = [
    ["Ta'mirlash", "Avto Servis Center MChJ", int(95, 150)],
    ["Ofis ijarasi", "Ofis Plus Savdo", 25],
    ["Bank xizmatlari", "Ofis Plus Savdo", int(2, 4)],
    ["Kommunal xizmatlar", "Elektr Tarmoqlari AJ", int(12, 22)],
    ["Marketing va reklama", "Ofis Plus Savdo", int(15, 32)],
    ["Sug'urta", "Xavfsiz Yo'l Sug'urta", 30],
    ["Kanselyariya", "Ofis Plus Savdo", int(3, 8)],
    ["Dasturiy ta'minot va IT", "UzbekTelecom MChJ", int(6, 10)],
    ["Xizmat safari va vakillik", "Ofis Plus Savdo", int(8, 18)],
    ["Autsorsing", "Avto Servis Center MChJ", int(20, 40)],
  ];
  /* Fuel is the single biggest cost line — billed monthly by the supplier. */
  for (let fuelIndex = 0; fuelIndex < 4; fuelIndex += 1) {
    createExpense(
      {
        companyId,
        date: `${month}-${String(4 + fuelIndex * 6).padStart(2, "0")}`,
        contactId: supplierByName["Toshkent Yonilg'i Ta'minot"] ?? null,
        categoryId: categories["Ta'mirlash"] ?? null,
        paymentAccountId: bank.id,
        amount: M(int(135, 185)),
        currency: BASE,
        description: `Dizel yonilg'i — ${month} (${fuelIndex + 1}-partiya)`,
        reference: `FUEL-${month}-${fuelIndex + 1}`,
        isPaid: true,
      },
      ctx,
    );
    expenseCount += 1;
  }

  for (const [categoryName, supplierName, millions] of expensePlan) {
    const date = `${month}-${String(int(2, 27)).padStart(2, "0")}`;
    createExpense(
      {
        companyId,
        date,
        contactId: supplierByName[supplierName] ?? null,
        categoryId: categories[categoryName] ?? null,
        paymentAccountId: bank.id,
        amount: M(millions * (1 + (rand() - 0.5) * 0.3)),
        taxAmount: 0,
        currency: BASE,
        description: `${categoryName} — ${month}`,
        reference: `EXP-${month}-${expenseCount + 1}`,
        isPaid: rand() < 0.9,
      },
      ctx,
    );
    expenseCount += 1;
  }
}

refreshOverdueInvoices(companyId, TODAY);
console.log(`  ${invoiceCount} invoices, ${billCount} supplier bills, ${expenseCount} expenses posted across ${months.length} months`);

/* -------------------------------------------------------------- stock moves */
for (const productId of products.slice(3)) {
  const info = one<{ purchase_price: number }>("SELECT purchase_price FROM products WHERE id = ?", [productId])!;
  recordStockMove({
    companyId,
    productId,
    warehouseId: warehouse.id,
    date: addDays(START, 10),
    direction: "in",
    qtyMilli: int(40, 200) * 1000,
    unitCost: info.purchase_price,
    refType: "opening",
    note: "Boshlang'ich qoldiq",
    ctx,
  });
}
transferStock(
  { companyId, productId: products[4], fromWarehouseId: warehouse.id, toWarehouseId: secondWarehouse, date: addDays(TODAY, -12), qtyMilli: 15_000, note: "Viloyat omboriga ko'chirish" },
  ctx,
);

/* ------------------------------------------------------------------ payroll */
for (const offset of [4, 3, 2, 1]) {
  const monthKey = addMonths(TODAY, -offset).slice(0, 7);
  const run = createPayrollRun({ companyId, period: monthKey, bankAccountId: bank.id }, ctx);
  if (offset !== 1) {
    payPayrollRun(companyId, run.runId, bank.id, ctx);
  }
}
createAdvance({ companyId, employeeId: employees[3], date: addDays(TODAY, -9), amount: M(2.5), bankAccountId: bank.id, note: "Avans so'rovi" }, ctx);
createAdvance({ companyId, employeeId: employees[5], date: addDays(TODAY, -6), amount: M(1.8), bankAccountId: cash.id, note: "Kassa orqali avans" }, ctx);

/* -------------------------------------------------- banking + reconciliation */
const statementRows = all<{ id: number; number: string; issueDate: string; total: number }>(
  "SELECT id, number, issue_date AS issueDate, total FROM invoices WHERE company_id = ? AND status IN ('sent','partially_paid','overdue') ORDER BY issue_date DESC LIMIT 6",
  [companyId],
).map((invoice) => ({
  date: invoice.issueDate,
  description: `Tushum: ${invoice.number}`,
  counterparty: "Bank o'tkazmasi",
  reference: invoice.number,
  direction: "in" as const,
  amount: invoice.total,
  raw: `АО Bank | ${invoice.date} | ${invoice.number} | in | ${invoice.total}`,
  warnings: [],
}));

const importResult = commitStatementImport(
  {
    companyId,
    bankAccountId: bank.id,
    filename: "hisobvaraq-kochirma-2026-09.csv",
    source: "csv",
    detectedBank: "Kapitalbank",
    rows: [
      ...statementRows,
      {
        date: TODAY,
        description: "Yonilg'i uchun to'lov",
        counterparty: "Toshkent Yonilg'i Ta'minot",
        reference: "TX-9931",
        direction: "out",
        amount: M(12.4),
        raw: "TX-9931 | out | 12.4",
        warnings: [],
      },
      {
        date: TODAY,
        description: "Komissiya — bank xizmatlari",
        counterparty: "Bank",
        reference: "FEE-2210",
        direction: "out",
        amount: M(0.35),
        raw: "FEE-2210 | out | 0.35",
        warnings: [],
      },
    ],
  },
  ctx,
);
console.log(`  bank statement imported: ${importResult.imported} rows (${importResult.duplicates} duplicates skipped)`);

/* ----------------------------------------------------------------- documents */
const textInvoice = `HISOB-FAKTURA INV-2026-0912
Yetkazib beruvchi: Ofis Plus Savdo STIR 313001122
Sana: ${addDays(TODAY, -4)}
Jami summa: ${(M(8.4) / 100).toFixed(2)} UZS
QQS: ${(M(0.9) / 100).toFixed(2)} UZS
Shartnoma: OF-2026-112`;
uploadDocument(
  {
    companyId,
    filename: "ofis-plus-hisob-faktura.txt",
    mime: "text/plain",
    buffer: Buffer.from(textInvoice, "utf8"),
    kind: "invoice",
    notes: "Demo: matnli hisob-faktura, maydonlar avtomatik aniqlandi",
  },
  ctx,
);
uploadDocument(
  {
    companyId,
    filename: "bank-kochirma-kapitalbank.csv",
    mime: "text/csv",
    buffer: Buffer.from(statementRows.map((row) => `${row.date};${row.description};${row.direction};${(row.amount / 100).toFixed(2)}`).join("\n"), "utf8"),
    kind: "statement",
    notes: "Demo: bank ko'chirmasi",
  },
  ctx,
);
/* A scan without a text layer — the product must say it cannot read it. */
uploadDocument(
  {
    companyId,
    filename: "skan-qilingan-kvitansiya.png",
    mime: "image/png",
    buffer: Buffer.from("89504e470d0a1a0a", "hex"),
    kind: "receipt",
    notes: "Demo: OCR o'qiy olmaydigan skan — qo'lda tekshirish uchun",
  },
  ctx,
);

/* ------------------------------------------------------------------- budgets */
const currentYear = Number(TODAY.slice(0, 4));
const currentMonthIndex = Number(TODAY.slice(5, 7));
for (const [categoryName, millions] of [["Ta'mirlash", 35], ["Ofis ijarasi", 12], ["Marketing va reklama", 12], ["Kommunal xizmatlar", 8]] as [string, number][]) {
  createBudget(
    {
      companyId,
      name: `${categoryName} — ${TODAY.slice(0, 7)}`,
      periodType: "month",
      year: currentYear,
      periodIndex: currentMonthIndex,
      scope: "category",
      categoryId: categories[categoryName] ?? null,
      amount: M(millions),
      notes: "Demo byudjet",
    },
    ctx,
  );
}

/* Deliberate duplicate so Xato Radar has something real to show (§39 demo). */
const duplicateSource = one<{ date: string; category_id: number; amount: number; description: string; reference: string }>(
  "SELECT date, category_id, amount, description, reference FROM expenses WHERE company_id = ? ORDER BY date DESC LIMIT 1",
  [companyId],
);
if (duplicateSource) {
  createExpense(
    {
      companyId,
      date: duplicateSource.date,
      categoryId: duplicateSource.category_id,
      paymentAccountId: bank.id,
      amount: duplicateSource.amount,
      currency: BASE,
      description: duplicateSource.description,
      reference: duplicateSource.reference,
      isPaid: true,
    },
    ctx,
  );
}

/* ----------------------------------------------- radar, tasks, notifications */
const period = resolvePeriod("this_month", { today: TODAY, locale: "uz" });
runXatoRadar(companyId, period, ctx);
generateTasks(companyId, period, ctx);
generateNotifications(companyId, period);
createTask(
  companyId,
  {
    title: "Oktyabr oyi uchun QQS hisob-kitobini tekshirish",
    description: "Soliq markazidagi QQS hisobini bosh kitob bilan solishtirish va tasdiqlash.",
    priority: "high",
    dueDate: addDays(TODAY, 7),
    type: "tax",
  },
  ctx,
);
createTask(
  companyId,
  {
    title: "Haydovchilar yo'l varaqalarini arxivlash",
    description: "Sentabr oyi yo'l varaqalarini skanerlab, hujjatlar bo'limiga yuklash.",
    priority: "medium",
    dueDate: addDays(TODAY, 3),
    type: "document",
  },
  ctx,
);

const counts = {
  contacts: one<{ count: number }>("SELECT COUNT(*) AS count FROM contacts WHERE company_id = ?", [companyId])?.count ?? 0,
  products: one<{ count: number }>("SELECT COUNT(*) AS count FROM products WHERE company_id = ?", [companyId])?.count ?? 0,
  invoices: one<{ count: number }>("SELECT COUNT(*) AS count FROM invoices WHERE company_id = ?", [companyId])?.count ?? 0,
  entries: one<{ count: number }>("SELECT COUNT(*) AS count FROM journal_entries WHERE company_id = ? AND status = 'posted'", [companyId])?.count ?? 0,
  alerts: one<{ count: number }>("SELECT COUNT(*) AS count FROM alerts WHERE company_id = ?", [companyId])?.count ?? 0,
  documents: one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ?", [companyId])?.count ?? 0,
};

console.log("\nDemo workspace ready");
console.log(`  company : ${COMPANY_NAME} (id ${companyId}, is_demo = 1)`);
console.log(`  sign in : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
console.log(`  data    : ${counts.contacts} contacts · ${counts.products} products · ${counts.invoices} invoices · ${counts.entries} journal entries`);
console.log(`            ${counts.alerts} radar findings · ${counts.documents} documents`);
console.log("\nEvery demo record is flagged is_demo = 1 and is never mixed with real companies.\n");
closeDb();
