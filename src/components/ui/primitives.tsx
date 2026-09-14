"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ utils */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

/* ----------------------------------------------------------------- button */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-[0_1px_2px_rgba(30,27,92,0.24)] hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300",
  secondary:
    "surface text-[color:var(--text)] border border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:surface-muted shadow-[var(--shadow-card)]",
  ghost: "text-[color:var(--text-muted)] hover:surface-muted hover:text-[color:var(--text)]",
  danger: "bg-negative-600 text-white hover:bg-negative-500 disabled:opacity-60",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[10px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[12px]",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-[14px]",
  icon: "h-9 w-9 rounded-[10px] justify-center",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "focus-ring inline-flex select-none items-center justify-center font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-70",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  prefetch,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cx(
        "focus-ring inline-flex select-none items-center justify-center font-medium transition-all duration-150",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------- card */
export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) {
  return (
    <div className={cx("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
  icon,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <div className="mt-0.5 text-[color:var(--text-subtle)]">{icon}</div> : null}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ badge */
export type BadgeTone = "neutral" | "positive" | "negative" | "warning" | "info" | "brand";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-[color:var(--surface-muted)] text-[color:var(--text-muted)] border-[color:var(--border)]",
  positive: "bg-positive-50 text-positive-600 border-positive-500/20",
  negative: "bg-negative-50 text-negative-600 border-negative-500/20",
  warning: "bg-warning-50 text-warning-600 border-warning-500/20",
  info: "bg-info-50 text-info-500 border-info-500/20",
  brand: "bg-brand-50 text-brand-700 border-brand-500/20",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export const STATUS_TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  sent: "info",
  partially_paid: "warning",
  paid: "positive",
  overdue: "negative",
  cancelled: "neutral",
  open: "info",
  posted: "brand",
  approved: "positive",
  pending: "warning",
  void: "neutral",
  matched: "positive",
  potential: "warning",
  unmatched: "neutral",
  duplicate: "negative",
  amount_mismatch: "negative",
  low: "neutral",
  medium: "warning",
  high: "negative",
  critical: "negative",
  todo: "neutral",
  in_progress: "info",
  completed: "positive",
  resolved: "positive",
  ignored: "neutral",
  reviewing: "warning",
  needs_review: "warning",
  active: "positive",
  archived: "neutral",
  upcoming: "info",
  due: "warning",
  failed: "negative",
};

/* ------------------------------------------------------------------ inputs */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={cx("block", className)}>
      {label ? (
        <span className="mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-muted">
          {label}
          {required ? <span className="text-negative-500">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="mt-1 block text-[12px] text-negative-600">{error}</span> : null}
      {hint && !error ? <span className="mt-1 block text-[12px] text-subtle">{hint}</span> : null}
    </label>
  );
}

const CONTROL_CLASS =
  "focus-ring w-full rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)] shadow-[var(--shadow-card)] transition-colors placeholder:text-[color:var(--text-subtle)] hover:border-[color:var(--border-strong)] disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(CONTROL_CLASS, "h-10", className)} {...rest} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(CONTROL_CLASS, "h-10 appearance-none bg-no-repeat pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(CONTROL_CLASS, "min-h-[84px]", className)} {...rest} />;
  },
);

export function Checkbox({
  label,
  checked,
  onChange,
  description,
  hint,
  name,
  value,
  defaultChecked,
  className,
}: {
  label: React.ReactNode;
  /** Controlled mode (dialogs, toggles). */
  checked?: boolean;
  onChange?: (value: boolean) => void;
  /** Uncontrolled mode (plain forms posted to a server action). */
  defaultChecked?: boolean;
  name?: string;
  value?: string;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  const helper = description ?? hint;
  const controlled = typeof checked === "boolean";
  return (
    <label className={cx("flex cursor-pointer items-start gap-2.5", className)}>
      <input
        type="checkbox"
        name={name}
        value={value ?? "1"}
        {...(controlled ? { checked, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.checked) } : { defaultChecked })}
        className="focus-ring mt-0.5 h-4 w-4 rounded border-[color:var(--border-strong)] accent-[color:var(--brand-600)]"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {helper ? <span className="mt-0.5 block text-[12.5px] text-muted">{helper}</span> : null}
      </span>
    </label>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  meta,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5 text-[12px] text-subtle">{breadcrumb}</div> : null}
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] lg:text-[26px]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-[13.5px] text-muted">{subtitle}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: React.ReactNode; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cx(
            "focus-ring flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors",
            active === tab.id
              ? "bg-brand-600 text-white"
              : "text-muted hover:surface-muted hover:text-[color:var(--text)]",
          )}
        >
          {tab.label}
          {typeof tab.count === "number" ? (
            <span
              className={cx(
                "rounded-full px-1.5 text-[11px]",
                active === tab.id ? "bg-white/20 text-white" : "bg-[color:var(--surface-muted)] text-muted",
              )}
            >
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- empty state */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  compact,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondary?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-6 text-center", compact ? "py-10" : "py-16")}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] border border-[color:var(--border)] surface-muted text-[color:var(--text-subtle)]">
        {icon ?? <DefaultEmptyIcon />}
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description ? <p className="mt-1.5 max-w-md text-[13px] text-muted">{description}</p> : null}
      {action || secondary ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

function DefaultEmptyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="M4 10h16M9 14h6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ modal */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" } as const;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="fixed inset-0 animate-[fade-in_0.15s_ease-out] bg-ink-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative z-10 w-full animate-[scale-in_0.16s_cubic-bezier(0.22,1,0.36,1)] rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-pop)]",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-[12.5px] text-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-[8px] p-1.5 text-subtle hover:surface-muted">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto scroll-thin px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-[color:var(--border)] px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  tone = "danger",
  loading,
}: {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-muted">{description}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ toasts */
export type Toast = { id: string; title: string; description?: string; tone?: "success" | "error" | "info" };

type ToastContextValue = {
  toasts: Toast[];
  toast: (toast: Omit<Toast, "id">) => void;
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((current) => [...current, { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toasts, toast: push, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "pointer-events-auto animate-[fade-up_0.24s_cubic-bezier(0.22,1,0.36,1)] rounded-[14px] border bg-[color:var(--surface)] p-3.5 shadow-[var(--shadow-pop)]",
              toast.tone === "error"
                ? "border-negative-500/30"
                : toast.tone === "success"
                  ? "border-positive-500/30"
                  : "border-[color:var(--border)]",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cx(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white",
                  toast.tone === "error" ? "bg-negative-500" : toast.tone === "success" ? "bg-positive-500" : "bg-brand-600",
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  {toast.tone === "error" ? <path d="M12 8v5M12 16.5v.5" /> : <path d="m5 13 4.5 4.5L19 7" />}
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 text-[12.5px] text-muted">{toast.description}</p> : null}
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} className="focus-ring rounded p-1 text-subtle hover:surface-muted" aria-label="Dismiss">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Toast API. `toast(...)` is the primary call site; `push` and `dismiss` are
 * exposed for the rare case where a toast must be updated by id.
 */
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

/* --------------------------------------------------------------- skeletons */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: cols }).map((__, colIndex) => (
            <Skeleton key={colIndex} className={cx("h-6 flex-1", colIndex === 0 && "max-w-[140px]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- misc */
export function InfoRow({ label, value, mono, hint }: { label: React.ReactNode; value: React.ReactNode; mono?: boolean; hint?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className={cx("text-right text-[13px] font-medium", mono && "num")}>
        {value}
        {hint ? <span className="mt-0.5 block text-[11.5px] font-normal text-subtle">{hint}</span> : null}
      </span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "focus-ring relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-brand-600" : "bg-[color:var(--border-strong)]",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute -top-8 left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-ink-900 px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100">
        {label}
      </span>
    </span>
  );
}

export function ProgressBar({ value, tone = "brand", className }: { value: number; tone?: "brand" | "positive" | "warning" | "negative"; className?: string }) {
  const tones = {
    brand: "bg-brand-600",
    positive: "bg-positive-500",
    warning: "bg-warning-500",
    negative: "bg-negative-500",
  } as const;
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-muted)]", className)}>
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : (label ?? "Copy")}
    </Button>
  );
}
