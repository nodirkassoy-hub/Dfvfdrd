export const ROLES = ["owner", "admin", "accountant", "manager", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  "manage_users",
  "manage_accounting",
  "manage_reports",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: ["view", "create", "edit", "delete", "approve", "export", "manage_users", "manage_accounting", "manage_reports"],
  accountant: ["view", "create", "edit", "approve", "export", "manage_accounting", "manage_reports"],
  manager: ["view", "create", "edit", "approve", "export"],
  viewer: ["view", "export"],
};

export const ROLE_LABELS: Record<Role, { en: string; uz: string; ru: string }> = {
  owner: { en: "Owner", uz: "Egasi", ru: "Владелец" },
  admin: { en: "Admin", uz: "Administrator", ru: "Администратор" },
  accountant: { en: "Accountant", uz: "Buxgalter", ru: "Бухгалтер" },
  manager: { en: "Manager", uz: "Menejer", ru: "Менеджер" },
  viewer: { en: "Viewer", uz: "Kuzatuvchi", ru: "Наблюдатель" },
};

export const PERMISSION_LABELS: Record<Permission, { en: string; uz: string; ru: string }> = {
  view: { en: "View records", uz: "Yozuvlarni ko'rish", ru: "Просмотр записей" },
  create: { en: "Create records", uz: "Yozuv yaratish", ru: "Создание записей" },
  edit: { en: "Edit records", uz: "Tahrirlash", ru: "Изменение записей" },
  delete: { en: "Delete records", uz: "O'chirish", ru: "Удаление записей" },
  approve: { en: "Approve payments & payroll", uz: "To'lov va ish haqini tasdiqlash", ru: "Утверждение платежей и зарплаты" },
  export: { en: "Export data", uz: "Ma'lumotni eksport qilish", ru: "Экспорт данных" },
  manage_users: { en: "Manage users", uz: "Foydalanuvchilarni boshqarish", ru: "Управление пользователями" },
  manage_accounting: { en: "Manage chart of accounts & periods", uz: "Hisoblar rejasi va davrlarni boshqarish", ru: "Управление планом счетов и периодами" },
  manage_reports: { en: "Manage reports & budgets", uz: "Hisobot va byudjetlarni boshqarish", ru: "Управление отчётами и бюджетами" },
};

export function permissionsFor(role: Role, extra: Permission[] = []): Permission[] {
  const base = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer;
  return [...new Set([...base, ...extra])];
}

export function can(permissions: Permission[], required: Permission): boolean {
  return permissions.includes(required);
}

export function assertCan(permissions: Permission[], required: Permission): void {
  if (!can(permissions, required)) {
    throw new Error(`FORBIDDEN:${required}`);
  }
}
