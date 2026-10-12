import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Subscription } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useSubmit } from "../hooks/useSubmit";
import { formatUtc, isValidLocalDateTime, nowAsLocalValue, toUtcIso } from "../lib/dates";
import { Empty, ErrorNotice, Field, Loading, Notice } from "./ui";

function EndForm({ subscription, onEnded }: { subscription: Subscription; onEnded: () => void }) {
  const [open, setOpen] = useState(false);
  const [endsAt, setEndsAt] = useState(nowAsLocalValue);
  const [clientError, setClientError] = useState<string>();
  const end = useSubmit((iso: string) => api.endSubscription(subscription.id, iso));

  if (!open) {
    return (
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
        End…
      </button>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValidLocalDateTime(endsAt)) {
      setClientError("Enter a valid end date and time.");
      return;
    }
    setClientError(undefined);
    if (await end.run(toUtcIso(endsAt))) {
      setOpen(false);
      onEnded();
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="End subscription">
      <Field id={`end-${subscription.id}`} label="Ends at (UTC)" error={clientError ?? end.error?.fields.ends_at}>
        {(p) => <input {...p} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
      </Field>
      {end.error && <ErrorNotice error={end.error} />}
      <div className="row">
        <button className="btn btn-small btn-primary" type="submit" disabled={end.busy}>
          {end.busy ? "Ending…" : "Confirm end"}
        </button>
        <button type="button" className="btn btn-small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SubscriptionsSection({ customerId }: { customerId: string }) {
  const subs = useAsync(() => api.listSubscriptions(customerId), [customerId]);
  const plans = useAsync(() => api.listPlans(), []);
  const [planId, setPlanId] = useState("");
  const [startsAt, setStartsAt] = useState(nowAsLocalValue);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string>();
  const start = useSubmit((plan: string, iso: string) => api.startSubscription(customerId, plan, iso));

  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? "Unknown plan";
  const errors = { ...(start.error?.fields ?? {}), ...clientErrors };
  const hasCurrent = subs.data?.some((s) => s.ends_at === null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(undefined);
    const found: Record<string, string> = {};
    if (!planId) found.plan_id = "Choose a plan.";
    if (!isValidLocalDateTime(startsAt)) found.starts_at = "Enter a valid start date and time.";
    setClientErrors(found);
    if (Object.keys(found).length > 0) return;
    const sub = await start.run(planId, toUtcIso(startsAt));
    if (sub) {
      setDone(`${planName(sub.plan_id)} starts ${formatUtc(sub.starts_at)}.`);
      subs.reload();
    }
  }

  return (
    <section className="card stack" aria-label="Subscriptions">
      <h2>Subscriptions</h2>

      {subs.loading && !subs.data && <Loading label="Loading subscriptions" />}
      {subs.error && <ErrorNotice error={subs.error} onRetry={subs.reload} />}
      {subs.data?.length === 0 && <Empty title="No subscription yet">Start one below so usage can be invoiced.</Empty>}
      {subs.data && subs.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Starts</th>
                <th>Ends</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.data.map((s) => (
                <tr key={s.id}>
                  <td>{planName(s.plan_id)}</td>
                  <td>{formatUtc(s.starts_at)}</td>
                  <td>{s.ends_at ? formatUtc(s.ends_at) : <span className="badge badge-ok">Active</span>}</td>
                  <td>{s.ends_at === null && <EndForm subscription={s} onEnded={subs.reload} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="stack" onSubmit={onSubmit} noValidate aria-label="Start subscription">
        <h3>{hasCurrent ? "Change plan" : "Start a subscription"}</h3>
        {plans.error && <ErrorNotice error={plans.error} onRetry={plans.reload} />}
        {plans.data?.length === 0 && (
          <Notice tone="info">There are no plans yet. Create one on the Plans page first.</Notice>
        )}
        <div className="row">
          <Field id="sub-plan" label="Plan" error={errors.plan_id}>
            {(p) => (
              <select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Select a plan…</option>
                {plans.data?.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="sub-starts"
            label="Starts at (UTC)"
            error={errors.starts_at}
            hint={hasCurrent ? "Changing plans ends the current subscription at this time." : undefined}
          >
            {(p) => <input {...p} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
          </Field>
        </div>
        {start.error && <ErrorNotice error={start.error} />}
        {done && <Notice tone="success">Subscription saved: {done}</Notice>}
        <div>
          <button className="btn btn-primary" type="submit" disabled={start.busy}>
            {start.busy ? "Saving…" : hasCurrent ? "Change plan" : "Start subscription"}
          </button>
        </div>
      </form>
    </section>
  );
}
