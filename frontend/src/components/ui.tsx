import type { ReactNode } from "react";
import type { DescribedError } from "../lib/errors";

/** A failure the person can act on: what happened, what to do, and (small) a code to quote. */
export function ErrorNotice({ error, onRetry }: { error: DescribedError; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <strong>{error.title}</strong>
      {error.detail && <p>{error.detail}</p>}
      {error.hint && <p className="hint">{error.hint}</p>}
      <div className="notice-footer">
        {onRetry && (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        )}
        {error.code && <code>{error.code}</code>}
      </div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "success" | "info"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}…
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** A labelled input with its error and hint wired up for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}
