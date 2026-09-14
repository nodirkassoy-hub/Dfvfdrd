/**
 * BUXAI chart of accounts and tax configuration.
 *
 * The chart follows the five accounting categories used by every modern
 * accounting framework (assets, liabilities, equity, revenue, expenses) with a
 * 4-digit numbering convention:
 *
 *   1xxx assets   2xxx liabilities   3xxx equity
 *   4xxx revenue  5xxx cost of goods sold   6xxx operating expenses
 *   7xxx other income   8xxx other expenses
 *
 * Account numbers are fully editable, so a company can remap BUXAI onto any
 * national template it is required to file with. Nothing in the engine depends
 * on a specific numbering.
 *
 * Tax rates below are *configuration defaults*, not legal advice. Each rate
 * carries a source note and can be changed in Settings → Tax. BUXAI always
 * shows the source alongside a calculated tax figure.
 */

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "cogs"
  | "expense"
  | "other_income"
  | "other_expense";

export type AccountSeed = {
  code: string;
  name: string;
  nameUz: string;
  nameRu: string;
  type: AccountType;
  subtype?: string;
  parent?: string;
  postable?: boolean;
  system?: boolean;
};

export const ACCOUNT_TYPE_META: Record<AccountType, { label: string; normal: "debit" | "credit"; group: string }> = {
  asset: { label: "Assets", normal: "debit", group: "balance" },
  liability: { label: "Liabilities", normal: "credit", group: "balance" },
  equity: { label: "Equity", normal: "credit", group: "balance" },
  revenue: { label: "Revenue", normal: "credit", group: "profit" },
  cogs: { label: "Cost of goods sold", normal: "debit", group: "profit" },
  expense: { label: "Operating expenses", normal: "debit", group: "profit" },
  other_income: { label: "Other income", normal: "credit", group: "profit" },
  other_expense: { label: "Other expenses", normal: "debit", group: "profit" },
};

export const ACCOUNT_TYPES: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
  "other_income",
  "other_expense",
];

/**
 * Structural (system) accounts. These are the accounts the engine posts to by
 * convention. They can be renamed and renumbered, but not deleted, because the
 * automation reads them by code.
 */
export const SYSTEM_ACCOUNTS = {
  CASH: "1010",
  BANK: "1020",
  AR: "1100",
  AR_TRADE: "1101",
  SUPPLIER_ADVANCES: "1102",
  EMPLOYEE_ADVANCES: "1103",
  INVENTORY: "1201",
  PREPAID: "1300",
  INPUT_VAT: "1400",
  AP: "2010",
  AP_TRADE: "2011",
  CUSTOMER_ADVANCES: "2012",
  PAYROLL_PAYABLE: "2020",
  VAT_PAYABLE: "2031",
  PROFIT_TAX_PAYABLE: "2032",
  PAYROLL_TAX_PAYABLE: "2033",
  SOCIAL_PAYABLE: "2034",
  OTHER_TAX_PAYABLE: "2035",
  ACCRUED: "2040",
  OPENING_EQUITY: "3090",
  SALES_GOODS: "4010",
  SALES_SERVICES: "4020",
  COGS_GOODS: "5010",
  COGS_SERVICES: "5020",
  SALARY_EXPENSE: "6010",
  SOCIAL_EXPENSE: "6020",
  DEPRECIATION_EXPENSE: "6120",
  FX_GAIN: "7020",
  FX_LOSS: "8020",
  BANK_FEES: "6080",
} as const;

export const DEFAULT_ACCOUNTS: AccountSeed[] = [
  /* ---------------------------------------------------------------- assets */
  { code: "1010", name: "Cash on hand", nameUz: "Kassadagi pul mablag'lari", nameRu: "Денежные средства в кассе", type: "asset", subtype: "cash", system: true },
  { code: "1020", name: "Bank accounts", nameUz: "Bank hisobvaraqlari", nameRu: "Банковские счета", type: "asset", subtype: "bank", postable: false, system: true },
  { code: "1021", name: "Main bank account (UZS)", nameUz: "Asosiy bank hisobi (UZS)", nameRu: "Основной банковский счёт (UZS)", type: "asset", subtype: "bank", parent: "1020" },

  { code: "1100", name: "Accounts receivable", nameUz: "Debitorlik qarzlar", nameRu: "Дебиторская задолженность", type: "asset", subtype: "receivable", postable: false, system: true },
  { code: "1101", name: "Trade receivables", nameUz: "Xaridorlardan qarzlar", nameRu: "Задолженность покупателей", type: "asset", subtype: "receivable", parent: "1100", system: true },
  { code: "1102", name: "Advances to suppliers", nameUz: "Yetkazib beruvchilarga berilgan avanslar", nameRu: "Авансы поставщикам", type: "asset", subtype: "receivable", parent: "1100", system: true },
  { code: "1103", name: "Advances to employees", nameUz: "Xodimlarga berilgan avanslar", nameRu: "Авансы сотрудникам", type: "asset", subtype: "receivable", parent: "1100", system: true },

  { code: "1200", name: "Inventory", nameUz: "Tovar-moddiy zaxiralar", nameRu: "Товарно-материальные запасы", type: "asset", subtype: "inventory", postable: false },
  { code: "1201", name: "Goods for resale", nameUz: "Sotish uchun tovarlar", nameRu: "Товары для перепродажи", type: "asset", subtype: "inventory", parent: "1200", system: true },
  { code: "1202", name: "Raw materials", nameUz: "Xom ashyo va materiallar", nameRu: "Сырьё и материалы", type: "asset", subtype: "inventory", parent: "1200" },
  { code: "1300", name: "Prepaid expenses", nameUz: "Kelgusi davrlar xarajatlari", nameRu: "Расходы будущих периодов", type: "asset", subtype: "prepaid", system: true },
  { code: "1400", name: "Input VAT (recoverable)", nameUz: "Hisobga olinadigan QQS", nameRu: "НДС к зачёту", type: "asset", subtype: "tax", system: true },

  { code: "1500", name: "Property, plant & equipment", nameUz: "Asosiy vositalar", nameRu: "Основные средства", type: "asset", subtype: "fixed_asset", postable: false },
  { code: "1501", name: "Machinery & equipment", nameUz: "Mashina va uskunalar", nameRu: "Машины и оборудование", type: "asset", subtype: "fixed_asset", parent: "1500" },
  { code: "1502", name: "Vehicles", nameUz: "Transport vositalari", nameRu: "Транспортные средства", type: "asset", subtype: "fixed_asset", parent: "1500" },
  { code: "1503", name: "Office & IT equipment", nameUz: "Ofis va IT texnikasi", nameRu: "Офисная и IT-техника", type: "asset", subtype: "fixed_asset", parent: "1500" },
  { code: "1510", name: "Accumulated depreciation", nameUz: "Asosiy vositalar eskirishi", nameRu: "Накопленная амортизация", type: "asset", subtype: "contra_asset", parent: "1500" },
  { code: "1600", name: "Intangible assets", nameUz: "Nomoddiy aktivlar", nameRu: "Нематериальные активы", type: "asset", subtype: "intangible" },
  { code: "1700", name: "Other long-term assets", nameUz: "Boshqa uzoq muddatli aktivlar", nameRu: "Прочие долгосрочные активы", type: "asset", subtype: "other" },

  /* ----------------------------------------------------------- liabilities */
  { code: "2010", name: "Accounts payable", nameUz: "Kreditorlik qarzlar", nameRu: "Кредиторская задолженность", type: "liability", subtype: "payable", postable: false, system: true },
  { code: "2011", name: "Trade payables", nameUz: "Yetkazib beruvchilarga qarzlar", nameRu: "Задолженность поставщикам", type: "liability", subtype: "payable", parent: "2010", system: true },
  { code: "2012", name: "Customer advances received", nameUz: "Olingan avanslar", nameRu: "Полученные авансы", type: "liability", subtype: "payable", parent: "2010", system: true },
  { code: "2020", name: "Payroll payable", nameUz: "Xodimlarga ish haqi bo'yicha qarz", nameRu: "Задолженность по оплате труда", type: "liability", subtype: "payroll", system: true },
  { code: "2030", name: "Taxes payable", nameUz: "Soliqlar bo'yicha qarzlar", nameRu: "Задолженность по налогам", type: "liability", subtype: "tax", postable: false },
  { code: "2031", name: "VAT payable", nameUz: "To'lanadigan QQS", nameRu: "НДС к уплате", type: "liability", subtype: "tax", parent: "2030", system: true },
  { code: "2032", name: "Profit tax payable", nameUz: "Foyda solig'i bo'yicha qarz", nameRu: "Задолженность по налогу на прибыль", type: "liability", subtype: "tax", parent: "2030", system: true },
  { code: "2033", name: "Payroll income tax payable", nameUz: "Daromad solig'i bo'yicha qarz", nameRu: "Задолженность по подоходному налогу", type: "liability", subtype: "tax", parent: "2030", system: true },
  { code: "2034", name: "Social contribution payable", nameUz: "Ijtimoiy soliq bo'yicha qarz", nameRu: "Задолженность по социальному налогу", type: "liability", subtype: "tax", parent: "2030", system: true },
  { code: "2035", name: "Other taxes payable", nameUz: "Boshqa soliqlar bo'yicha qarz", nameRu: "Прочие налоги к уплате", type: "liability", subtype: "tax", parent: "2030", system: true },
  { code: "2040", name: "Accrued liabilities", nameUz: "Hisoblangan majburiyatlar", nameRu: "Начисленные обязательства", type: "liability", subtype: "accrued", system: true },
  { code: "2050", name: "Borrowings", nameUz: "Kreditlar va qarzlar", nameRu: "Кредиты и займы", type: "liability", subtype: "loan", postable: false },
  { code: "2051", name: "Long-term loans", nameUz: "Uzoq muddatli kreditlar", nameRu: "Долгосрочные кредиты", type: "liability", subtype: "loan", parent: "2050" },
  { code: "2052", name: "Short-term loans", nameUz: "Qisqa muddatli kreditlar", nameRu: "Краткосрочные кредиты", type: "liability", subtype: "loan", parent: "2050" },
  { code: "2060", name: "Dividends payable", nameUz: "To'lanadigan dividendlar", nameRu: "Дивиденды к выплате", type: "liability", subtype: "other" },

  /* ---------------------------------------------------------------- equity */
  { code: "3010", name: "Charter capital", nameUz: "Ustav kapitali", nameRu: "Уставный капитал", type: "equity", subtype: "capital" },
  { code: "3020", name: "Retained earnings", nameUz: "Taqsimlanmagan foyda", nameRu: "Нераспределённая прибыль", type: "equity", subtype: "retained" },
  { code: "3030", name: "Current year result", nameUz: "Joriy yil natijasi", nameRu: "Результат текущего года", type: "equity", subtype: "retained" },
  { code: "3040", name: "Owner's drawings", nameUz: "Egasi hisobidan olingan mablag'lar", nameRu: "Изъятия собственника", type: "equity", subtype: "drawings" },
  { code: "3090", name: "Opening balances", nameUz: "Boshlang'ich qoldiqlar", nameRu: "Входящие остатки", type: "equity", subtype: "opening", system: true },

  /* --------------------------------------------------------------- revenue */
  { code: "4010", name: "Sales of goods", nameUz: "Tovar sotishdan tushum", nameRu: "Выручка от продажи товаров", type: "revenue", subtype: "operating", system: true },
  { code: "4020", name: "Services rendered", nameUz: "Xizmat ko'rsatishdan tushum", nameRu: "Выручка от оказания услуг", type: "revenue", subtype: "operating", system: true },
  { code: "4030", name: "Other operating revenue", nameUz: "Boshqa operatsion tushumlar", nameRu: "Прочие операционные доходы", type: "revenue", subtype: "operating" },
  { code: "4040", name: "Sales returns & discounts", nameUz: "Sotuvdan qaytimlar va chegirmalar", nameRu: "Возвраты и скидки по продажам", type: "revenue", subtype: "contra" },

  /* ------------------------------------------------------------------ COGS */
  { code: "5010", name: "Cost of goods sold", nameUz: "Sotilgan tovarlar tannarxi", nameRu: "Себестоимость проданных товаров", type: "cogs", subtype: "goods", system: true },
  { code: "5020", name: "Cost of services", nameUz: "Ko'rsatilgan xizmatlar tannarxi", nameRu: "Себестоимость услуг", type: "cogs", subtype: "services", system: true },
  { code: "5030", name: "Purchase returns & discounts", nameUz: "Xarid qaytimlari va chegirmalar", nameRu: "Возвраты и скидки по закупкам", type: "cogs", subtype: "contra" },

  /* --------------------------------------------------- operating expenses */
  { code: "6010", name: "Salaries & wages", nameUz: "Ish haqi xarajatlari", nameRu: "Расходы на оплату труда", type: "expense", subtype: "payroll", system: true },
  { code: "6020", name: "Social contribution expense", nameUz: "Ijtimoiy soliq xarajati", nameRu: "Расходы по социальному налогу", type: "expense", subtype: "payroll", system: true },
  { code: "6030", name: "Office rent", nameUz: "Ofis ijarasi", nameRu: "Аренда офиса", type: "expense", subtype: "facility" },
  { code: "6040", name: "Utilities", nameUz: "Kommunal xizmatlar", nameRu: "Коммунальные услуги", type: "expense", subtype: "facility" },
  { code: "6050", name: "Marketing & advertising", nameUz: "Marketing va reklama", nameRu: "Маркетинг и реклама", type: "expense", subtype: "sales" },
  { code: "6060", name: "Software & IT", nameUz: "Dasturiy ta'minot va IT", nameRu: "ПО и IT-инфраструктура", type: "expense", subtype: "admin" },
  { code: "6070", name: "Professional services", nameUz: "Professional xizmatlar", nameRu: "Профессиональные услуги", type: "expense", subtype: "admin" },
  { code: "6080", name: "Bank fees", nameUz: "Bank xizmatlari", nameRu: "Банковские комиссии", type: "expense", subtype: "finance", system: true },
  { code: "6090", name: "Travel & representation", nameUz: "Xizmat safari va vakillik", nameRu: "Командировки и представительские", type: "expense", subtype: "admin" },
  { code: "6100", name: "Office supplies", nameUz: "Kanselyariya va ofis", nameRu: "Канцелярия и офис", type: "expense", subtype: "admin" },
  { code: "6110", name: "Repairs & maintenance", nameUz: "Ta'mirlash va texnik xizmat", nameRu: "Ремонт и обслуживание", type: "expense", subtype: "facility" },
  { code: "6120", name: "Depreciation expense", nameUz: "Asosiy vositalar eskirishi", nameRu: "Амортизационные расходы", type: "expense", subtype: "non_cash", system: true },
  { code: "6130", name: "Inventory write-offs", nameUz: "Zaxiralarni hisobdan chiqarish", nameRu: "Списание запасов", type: "expense", subtype: "inventory" },
  { code: "6140", name: "Taxes & duties", nameUz: "Soliqlar va yig'imlar", nameRu: "Налоги и сборы", type: "expense", subtype: "tax" },
  { code: "6150", name: "Insurance", nameUz: "Sug'urta", nameRu: "Страхование", type: "expense", subtype: "admin" },
  { code: "6160", name: "Outsourced services", nameUz: "Autsorsing xizmatlari", nameRu: "Аутсорсинговые услуги", type: "expense", subtype: "admin" },
  { code: "6170", name: "Staff training", nameUz: "Xodimlarni o'qitish", nameRu: "Обучение персонала", type: "expense", subtype: "admin" },
  { code: "6190", name: "Other operating expenses", nameUz: "Boshqa operatsion xarajatlar", nameRu: "Прочие операционные расходы", type: "expense", subtype: "other" },

  /* ---------------------------------------------------------- other income */
  { code: "7010", name: "Interest income", nameUz: "Foiz daromadlari", nameRu: "Процентные доходы", type: "other_income", subtype: "finance" },
  { code: "7020", name: "Foreign exchange gain", nameUz: "Valyuta kursi farqidan foyda", nameRu: "Курсовая прибыль", type: "other_income", subtype: "fx", system: true },
  { code: "7030", name: "Gain on asset disposal", nameUz: "Aktivlarni sotishdan foyda", nameRu: "Прибыль от выбытия активов", type: "other_income", subtype: "other" },
  { code: "7040", name: "Sundry income", nameUz: "Boshqa daromadlar", nameRu: "Прочие доходы", type: "other_income", subtype: "other" },

  /* -------------------------------------------------------- other expenses */
  { code: "8010", name: "Interest expense", nameUz: "Foiz xarajatlari", nameRu: "Процентные расходы", type: "other_expense", subtype: "finance" },
  { code: "8020", name: "Foreign exchange loss", nameUz: "Valyuta kursi farqidan zarar", nameRu: "Курсовой убыток", type: "other_expense", subtype: "fx", system: true },
  { code: "8030", name: "Loss on asset disposal", nameUz: "Aktivlar chiqimidan zarar", nameRu: "Убыток от выбытия активов", type: "other_expense", subtype: "other" },
  { code: "8040", name: "Penalties & fines", nameUz: "Jarima va penya", nameRu: "Штрафы и пени", type: "other_expense", subtype: "other" },
  { code: "8050", name: "Sundry expenses", nameUz: "Boshqa xarajatlar", nameRu: "Прочие расходы", type: "other_expense", subtype: "other" },
];

export type TaxCodeSeed = {
  code: string;
  name: string;
  kind: "vat" | "payroll" | "social" | "profit" | "turnover" | "other";
  rateBp: number;
  account?: string;
  sourceNote: string;
};

/**
 * Country default tax configuration. BUXAI labels these as configurable
 * reference values and always surfaces the source note in the UI. They are not
 * a legal statement — see docs and Settings → Tax.
 */
export const DEFAULT_TAX_CODES: TaxCodeSeed[] = [
  {
    code: "VAT12",
    name: "VAT 12%",
    kind: "vat",
    rateBp: 1200,
    account: "2031",
    sourceNote:
      "Configured default VAT rate. Verify the applicable rate and whether your company is a VAT payer with the official tax authority (soliq.uz) or your tax adviser.",
  },
  {
    code: "VAT0",
    name: "VAT 0% (export)",
    kind: "vat",
    rateBp: 0,
    account: "2031",
    sourceNote: "Zero-rated supplies. Confirm eligibility conditions with the official source before applying.",
  },
  {
    code: "EXEMPT",
    name: "VAT exempt",
    kind: "vat",
    rateBp: 0,
    sourceNote: "Exempt turnover. Confirm the list of exempt operations in the current Tax Code.",
  },
  {
    code: "TURN4",
    name: "Turnover tax 4%",
    kind: "turnover",
    rateBp: 400,
    account: "2035",
    sourceNote:
      "Configured default for the simplified turnover-tax regime. Rate depends on activity and region. Verify with the official source or your tax adviser.",
  },
  {
    code: "PROFIT15",
    name: "Profit tax 15%",
    kind: "profit",
    rateBp: 1500,
    account: "2032",
    sourceNote: "Configured default corporate profit tax rate. Verify the current rate and your eligibility for incentives.",
  },
  {
    code: "PIT12",
    name: "Payroll income tax 12%",
    kind: "payroll",
    rateBp: 1200,
    account: "2033",
    sourceNote: "Configured default rate for payroll income tax. Actual liability depends on employee status, benefits and deductions.",
  },
  {
    code: "SOC12",
    name: "Social contribution 12%",
    kind: "social",
    rateBp: 1200,
    account: "2034",
    sourceNote: "Configured default employer social contribution. Rates vary by taxpayer category — verify before filing.",
  },
];

export const TAX_SOURCES = [
  { label: "Tax Committee of the Republic of Uzbekistan", url: "https://soliq.uz", note: "Official tax authority — rates, deadlines and payer obligations." },
  { label: "Lex.uz — national legislation database", url: "https://lex.uz", note: "Current Tax Code text and amendments." },
] as const;

export type CategorySeed = { name: string; nameUz: string; nameRu: string; kind: "expense" | "income"; account: string; keywords?: string[] };

/** Expense / income categories used for analytics, budgets and AI classification. */
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  { name: "Salaries & wages", nameUz: "Ish haqi", nameRu: "Оплата труда", kind: "expense", account: "6010", keywords: ["salary", "ish haqi", "зарплата", "wage"] },
  { name: "Social contribution", nameUz: "Ijtimoiy soliq", nameRu: "Социальный налог", kind: "expense", account: "6020", keywords: ["social", "ijtimoiy", "соцналог"] },
  { name: "Office rent", nameUz: "Ofis ijarasi", nameRu: "Аренда офиса", kind: "expense", account: "6030", keywords: ["rent", "ijara", "аренда", "arenda"] },
  { name: "Utilities", nameUz: "Kommunal xizmatlar", nameRu: "Коммунальные услуги", kind: "expense", account: "6040", keywords: ["utility", "kommunal", "коммунал", "electric", "suv", "gaz"] },
  { name: "Marketing & advertising", nameUz: "Marketing va reklama", nameRu: "Маркетинг и реклама", kind: "expense", account: "6050", keywords: ["marketing", "reklama", "ads", "реклама", "google ads", "facebook", "target"] },
  { name: "Software & IT", nameUz: "Dasturiy ta'minot va IT", nameRu: "ПО и IT", kind: "expense", account: "6060", keywords: ["software", "hosting", "server", "saas", "subscription", "it"] },
  { name: "Professional services", nameUz: "Professional xizmatlar", nameRu: "Профессиональные услуги", kind: "expense", account: "6070", keywords: ["consulting", "legal", "audit", "konsalting", "юрист"] },
  { name: "Bank fees", nameUz: "Bank xizmatlari", nameRu: "Банковские комиссии", kind: "expense", account: "6080", keywords: ["bank", "commission", "komissiya", "комиссия", "fee"] },
  { name: "Travel & representation", nameUz: "Xizmat safari va vakillik", nameRu: "Командировки и представительские", kind: "expense", account: "6090", keywords: ["travel", "hotel", "flight", "safar", "командировка"] },
  { name: "Office supplies", nameUz: "Kanselyariya", nameRu: "Канцелярия", kind: "expense", account: "6100", keywords: ["supplies", "stationery", "kanselyariya", "канцелярия"] },
  { name: "Repairs & maintenance", nameUz: "Ta'mirlash", nameRu: "Ремонт", kind: "expense", account: "6110", keywords: ["repair", "ta'mir", "ремонт", "service"] },
  { name: "Taxes & duties", nameUz: "Soliqlar va yig'imlar", nameRu: "Налоги и сборы", kind: "expense", account: "6140", keywords: ["tax", "soliq", "налог"] },
  { name: "Insurance", nameUz: "Sug'urta", nameRu: "Страхование", kind: "expense", account: "6150", keywords: ["insurance", "sugurta", "страхование"] },
  { name: "Outsourced services", nameUz: "Autsorsing", nameRu: "Аутсорсинг", kind: "expense", account: "6160", keywords: ["outsource", "autsorsing", "аутсорсинг", "freelance"] },
  { name: "Other operating expenses", nameUz: "Boshqa xarajatlar", nameRu: "Прочие расходы", kind: "expense", account: "6190", keywords: ["other", "boshqa", "прочее"] },
  { name: "Interest & finance cost", nameUz: "Foiz xarajatlari", nameRu: "Процентные расходы", kind: "expense", account: "8010", keywords: ["interest", "loan", "foiz", "процент"] },
  { name: "Sales of goods", nameUz: "Tovar sotish", nameRu: "Продажа товаров", kind: "income", account: "4010", keywords: ["sale", "goods", "tovar", "товар"] },
  { name: "Services rendered", nameUz: "Xizmat ko'rsatish", nameRu: "Услуги", kind: "income", account: "4020", keywords: ["service", "xizmat", "услуг"] },
  { name: "Other income", nameUz: "Boshqa daromadlar", nameRu: "Прочие доходы", kind: "income", account: "7040", keywords: ["other income", "boshqa daromad"] },
];

export const DEFAULT_DEPARTMENTS = [
  { name: "Management", nameUz: "Boshqaruv", nameRu: "Руководство" },
  { name: "Finance", nameUz: "Moliya", nameRu: "Финансы" },
  { name: "Sales & marketing", nameUz: "Sotuv va marketing", nameRu: "Продажи и маркетинг" },
  { name: "Operations", nameUz: "Operatsiyalar", nameRu: "Операции" },
  { name: "Warehouse", nameUz: "Omborxona", nameRu: "Склад" },
  { name: "IT", nameUz: "IT", nameRu: "IT" },
];
