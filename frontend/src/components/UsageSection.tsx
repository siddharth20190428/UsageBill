import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { UsageInput } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useSubmit } from "../hooks/useSubmit";
import { formatUtc, isValidLocalDateTime, nowAsLocalValue, toUtcIso } from "../lib/dates";
import { newIdempotencyKey } from "../lib/ids";
import { formatQuantity, isDecimal, isZero } from "../lib/money";
import { Empty, ErrorNotice, Field, Loading, Notice } from "./ui";

export function UsageSection({ customerId }: { customerId: string }) {
  const usage = useAsync(() => api.listUsage(customerId), [customerId]);
  const [quantity, setQuantity] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowAsLocalValue);
  // The key identifies one *intended* event. It only changes after a success, so retrying a failed
  // or unanswered request re-sends the same key and can never double-count.
  const [key, setKey] = useState(newIdempotencyKey);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ duplicate: boolean; quantity: string }>();
  const [lastRequest, setLastRequest] = useState<UsageInput>();
  const record = useSubmit((input: UsageInput) => api.recordUsage(input));

  const errors = { ...(record.error?.fields ?? {}), ...clientErrors };

  async function send(input: UsageInput, fresh: boolean) {
    setOutcome(undefined);
    const result = await record.run(input);
    if (!result) return; // failed: keep the form and the key as they are
    setOutcome({ duplicate: result.status === 200, quantity: result.data.quantity });
    setLastRequest(input);
    if (fresh) {
      setQuantity("");
      setKey(newIdempotencyKey());
    }
    usage.reload();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    const q = quantity.trim();
    if (!isDecimal(q, 6)) found.quantity = "Enter a positive number with at most 6 decimal places.";
    else if (isZero(q)) found.quantity = "Quantity must be greater than zero.";
    if (!isValidLocalDateTime(occurredAt)) found.occurred_at = "Enter a valid date and time.";
    if (!key.trim()) found.idempotency_key = "An idempotency key is required.";
    setClientErrors(found);
    if (Object.keys(found).length > 0) return;
    await send(
      { customer_id: customerId, quantity: q, occurred_at: toUtcIso(occurredAt), idempotency_key: key.trim() },
      true,
    );
  }

  return (
    <section className="card stack" aria-label="Usage">
      <h2>Usage</h2>
      <form className="stack" onSubmit={onSubmit} noValidate aria-label="Record usage">
        <div className="row">
          <Field id="usage-quantity" label="Quantity" error={errors.quantity}>
            {(p) => (
              <input
                {...p}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setClientErrors({});
                }}
              />
            )}
          </Field>
          <Field id="usage-occurred" label="Occurred at (UTC)" error={errors.occurred_at}>
            {(p) => (
              <input
                {...p}
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => {
                  setOccurredAt(e.target.value);
                  setClientErrors({});
                }}
              />
            )}
          </Field>
        </div>
        <Field
          id="usage-key"
          label="Idempotency key"
          error={errors.idempotency_key}
          hint="Sending the same key twice records the event once. The key is kept if a request fails, so retrying is safe."
        >
          {(p) => (
            <input
              {...p}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setClientErrors({});
              }}
              autoComplete="off"
            />
          )}
        </Field>
        {record.error && <ErrorNotice error={record.error} />}
        {outcome && !outcome.duplicate && (
          <Notice tone="success">Recorded {formatQuantity(outcome.quantity)} units.</Notice>
        )}
        {outcome?.duplicate && (
          <Notice tone="info">
            <strong>Already recorded.</strong> This key was used before, so nothing was added and your total is
            unchanged.
          </Notice>
        )}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={record.busy}>
            {record.busy ? "Recording…" : "Record usage"}
          </button>
          {lastRequest && (
            <button
              type="button"
              className="btn"
              disabled={record.busy}
              onClick={() => void send(lastRequest, false)}
              title="Re-sends the last request with the same key, as a client would after a timeout."
            >
              Retry the same request
            </button>
          )}
        </div>
      </form>

      <h3>Recent usage</h3>
      {usage.loading && !usage.data && <Loading label="Loading usage" />}
      {usage.error && <ErrorNotice error={usage.error} onRetry={usage.reload} />}
      {usage.data?.length === 0 && <Empty title="No usage recorded yet">Events you record appear here.</Empty>}
      {usage.data && usage.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Occurred</th>
                <th className="num">Quantity</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.map((u) => (
                <tr key={u.id}>
                  <td>{formatUtc(u.occurred_at)}</td>
                  <td className="num">{formatQuantity(u.quantity)}</td>
                  <td>
                    <code>{u.idempotency_key}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
