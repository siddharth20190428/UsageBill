import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Plan, Quote } from "../api/types";
import { useSubmit } from "../hooks/useSubmit";
import { formatMoney, formatQuantity, formatUnitPrice, isDecimal } from "../lib/money";
import { PlanForm } from "./PlanForm";
import { ConfirmDialog, Modal, RowMenu } from "./overlay";
import { ErrorNotice, Field } from "./ui";

export function tierRows(plan: Plan): { range: string; price: string }[] {
  let from = "0";
  return plan.tiers.map((t) => {
    const range = t.up_to === null ? (from === "0" ? "All usage" : `Above ${formatQuantity(from)}`) : `${formatQuantity(from)} – ${formatQuantity(t.up_to)}`;
    if (t.up_to !== null) from = t.up_to;
    return { range, price: `${plan.currency} ${formatUnitPrice(t.unit_price)}` };
  });
}

export function PlanCard({ plan, onChanged, onFlash }: { plan: Plan; onChanged: () => void; onFlash: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [clientError, setClientError] = useState<string>();
  const [quote, setQuote] = useState<Quote>();
  const ask = useSubmit((q: string) => api.quote(plan.id, q));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setQuote(undefined);
    if (!isDecimal(quantity, 6)) {
      setClientError("Enter a quantity, e.g. 2500 (up to 6 decimal places).");
      return;
    }
    setClientError(undefined);
    const result = await ask.run(quantity.trim());
    if (result) setQuote(result);
  }

  return (
    <section className="panel" aria-label={plan.name}>
      <div className="panel-head">
        <div className="plan-title">
          <h2>{plan.name}</h2>
          <span className="chip">{plan.currency}</span>
        </div>
        <div className="plan-meta">
          <span className="muted">Base fee</span>
          <span className="num strong">{formatMoney(plan.base_fee, plan.currency)}</span>
          <span className="muted">/ month</span>
          <RowMenu label={`Actions for ${plan.name}`} items={[
            { label: "Edit", onSelect: () => setEditing(true) },
            { label: "Delete", danger: true, onSelect: () => setDeleting(true) },
          ]} />
        </div>
      </div>

      <div className="table-wrap">
        <table aria-label={`${plan.name} tiers`}>
          <thead>
            <tr><th>Usage</th><th className="num">Price per unit</th></tr>
          </thead>
          <tbody>
            {tierRows(plan).map((r) => (
              <tr key={r.range}><td>{r.range}</td><td className="num">{r.price}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="estimate">
        <summary>Price calculator</summary>
        <form className="inline-form" onSubmit={onSubmit} noValidate aria-label={`Quote for ${plan.name}`}>
          <Field id={`quote-${plan.id}`} label="Quantity in a month" error={clientError}>
            {(p) => (
              <input {...p} inputMode="decimal" value={quantity}
                onChange={(e) => { setQuantity(e.target.value); setClientError(undefined); }} />
            )}
          </Field>
          <button className="btn" type="submit" disabled={ask.busy}>{ask.busy ? "Calculating…" : "Calculate"}</button>
        </form>
        {ask.error && <ErrorNotice error={ask.error} />}
        {quote && (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr><th>Tier</th><th className="num">Quantity</th><th className="num">Unit price</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                <tr><td>Base fee</td><td /><td /><td className="num">{formatMoney(quote.base_fee, quote.currency)}</td></tr>
                {quote.lines.map((l) => (
                  <tr key={l.tier}>
                    <td>Tier {l.tier}</td>
                    <td className="num">{formatQuantity(l.quantity)}</td>
                    <td className="num">{formatUnitPrice(l.unit_price)}</td>
                    <td className="num">{formatMoney(l.amount, quote.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>Total</td><td className="num">{formatMoney(quote.total, quote.currency)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </details>

      {editing && (
        <Modal title={`Edit ${plan.name}`} wide onClose={() => setEditing(false)}>
          <PlanForm plan={plan} onCancel={() => setEditing(false)}
            onSaved={(p) => { setEditing(false); onFlash(`Saved “${p.name}”.`); onChanged(); }} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog title="Delete plan?" confirmLabel="Delete plan" onClose={() => setDeleting(false)}
          onConfirm={async () => { await api.deletePlan(plan.id); onFlash(`Deleted “${plan.name}”.`); onChanged(); }}>
          This permanently deletes <strong>{plan.name}</strong>. Plans that customers are subscribed to can't be deleted.
        </ConfirmDialog>
      )}
    </section>
  );
}
