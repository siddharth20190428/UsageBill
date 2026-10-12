import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Plan, Quote } from "../api/types";
import { useSubmit } from "../hooks/useSubmit";
import { formatMoney, formatQuantity, formatUnitPrice, isDecimal } from "../lib/money";
import { ErrorNotice, Field } from "./ui";

export function tierSummary(plan: Plan): string[] {
  let from = "0";
  return plan.tiers.map((t) => {
    const price = `${plan.currency} ${formatUnitPrice(t.unit_price)} per unit`;
    const range =
      t.up_to === null ? `Above ${formatQuantity(from)}` : `${formatQuantity(from)} to ${formatQuantity(t.up_to)}`;
    if (t.up_to !== null) from = t.up_to;
    return `${range}: ${price}`;
  });
}

export function PlanCard({ plan }: { plan: Plan }) {
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
    <li className="stack">
      <div className="spread">
        <strong>{plan.name}</strong>
        <span className="muted">
          {plan.currency} · base fee {formatMoney(plan.base_fee, plan.currency)} / month
        </span>
      </div>
      <ul className="tiers" aria-label={`${plan.name} tiers`}>
        {tierSummary(plan).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <details>
        <summary>Price calculator</summary>
        <form className="row" onSubmit={onSubmit} noValidate aria-label={`Quote for ${plan.name}`}>
          <Field id={`quote-${plan.id}`} label="Quantity in a month" error={clientError}>
            {(p) => (
              <input
                {...p}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setClientError(undefined);
                }}
              />
            )}
          </Field>
          <button className="btn" type="submit" disabled={ask.busy} style={{ marginTop: 24 }}>
            {ask.busy ? "Calculating…" : "Calculate"}
          </button>
        </form>
        {ask.error && <ErrorNotice error={ask.error} />}
        {quote && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th className="num">Quantity</th>
                  <th className="num">Unit price</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Base fee</td>
                  <td />
                  <td />
                  <td className="num">{formatMoney(quote.base_fee, quote.currency)}</td>
                </tr>
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
                <tr>
                  <td colSpan={3}>Total</td>
                  <td className="num">{formatMoney(quote.total, quote.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </details>
    </li>
  );
}
