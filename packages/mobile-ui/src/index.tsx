import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from "react";

export const mobileTokens = {
  color: {
    background: "#f5f7f8",
    surface: "#ffffff",
    ink: "#102a2c",
    muted: "#53686a",
    primary: "#0a5c5f",
    border: "#cad5d5",
    success: "#167047",
    warning: "#8a4d00",
    danger: "#a12b2b",
    info: "#235fa4",
    synthetic: "#6e4aa8",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 8, md: 14, lg: 20 },
  touchTarget: 44,
} as const;

export function Screen({ children }: PropsWithChildren) {
  return <main className="screen">{children}</main>;
}
export function Card({
  children,
  accessibilityLabel,
}: PropsWithChildren<{ accessibilityLabel?: string }>) {
  return (
    <section className="card" aria-label={accessibilityLabel}>
      {children}
    </section>
  );
}
export function AppText({
  children,
  variant = "body",
}: {
  children: ReactNode;
  variant?: "title" | "heading" | "body" | "caption";
}) {
  return variant === "title" ? (
    <h1>{children}</h1>
  ) : variant === "heading" ? (
    <h2>{children}</h2>
  ) : variant === "caption" ? (
    <small>{children}</small>
  ) : (
    <p>{children}</p>
  );
}
export function Field({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = props.id ?? label.replace(/\s+/g, "-").toLowerCase();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <span id={`${id}-error`} role="alert" className="error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
export function Button({
  label,
  busy,
  tone = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  busy?: boolean;
  tone?: "primary" | "danger" | "secondary";
}) {
  return (
    <button
      {...props}
      className={`button ${tone}`}
      aria-busy={busy}
      disabled={props.disabled || busy}
    >
      {busy ? `${label}…` : label}
    </button>
  );
}
export function StatusBadge({
  label,
  tone = "info",
}: {
  label: string;
  tone?: "success" | "warning" | "danger" | "info" | "synthetic";
}) {
  const prefix =
    tone === "success"
      ? "Success"
      : tone === "danger"
        ? "Danger"
        : tone === "warning"
          ? "Warning"
          : tone === "synthetic"
            ? "Synthetic data"
            : "Information";
  return (
    <span className={`badge ${tone}`} aria-label={`${prefix}: ${label}`}>
      {prefix}: {label}
    </span>
  );
}
export function Banner({
  title,
  message,
  tone = "warning",
}: {
  title: string;
  message: string;
  tone?: "warning" | "danger" | "info";
}) {
  return (
    <aside role="alert" className={`banner ${tone}`}>
      <strong>{title}</strong>
      <span>{message}</span>
    </aside>
  );
}
export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      {label}…
    </div>
  );
}
export function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
