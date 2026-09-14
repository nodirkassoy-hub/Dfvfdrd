export type AccountingErrorCode =
  | "UNBALANCED_ENTRY"
  | "NO_LINES"
  | "INVALID_LINE"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_POSTABLE"
  | "ACCOUNT_ARCHIVED"
  | "PERIOD_CLOSED"
  | "NON_POSITIVE_AMOUNT"
  | "CURRENCY_MISMATCH"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_ALREADY_VOID"
  | "DUPLICATE_NUMBER"
  | "CONTACT_NOT_FOUND"
  | "INSUFFICIENT_PERMISSION";

export class AccountingError extends Error {
  code: AccountingErrorCode;
  details?: Record<string, unknown>;

  constructor(code: AccountingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AccountingError";
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.details = details;
  }
}
