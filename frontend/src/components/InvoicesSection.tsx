import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Invoice } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useSubmit } from "../hooks/useSubmit";
import { formatMonth, previousMonth } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { InvoiceView } from "./InvoiceView";
import { Empty, ErrorNotice, Field, Loading, Notice } from "./ui";

export function InvoicesSection({ customerId }: { customerId: string }) {
  const invoices = useAsync(() => api.listInvoices(customerId), [customerId]);
  const [period, setPeriod] = useState(() => previousMonth());
  const [clientError, setClientError] = useState<string>();
  const [outcome, setOutcome] = useState<{ created: boolean; invoice: Invoice }>();
  const generate = useSubmit((p: string) => api.generateInvoice(customerId, p));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setOutcome(undefined);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      setClientError("Choose a month.");
      return;
    }
    setClientError(undefined);
    const result = await generate.run(period);
    if (result) {
      setOutcome({ created: result.status === 201, invoice: result.data });
      invoices.reload();
    }
  }

  return (
    <section className="card stack" aria-label="Invoices">
      <h2>Invoices</h2>
      <form className="row" onSubmit={onSubmit} noValidate aria-label="Generate invoice">
        <Field
          id="invoice-period"
          label="Billing month (UTC)"
          error={clientError ?? generate.error?.fields.period}
          hint="Only months that have ended can be invoiced."
        >
          {(p) => (
            <input
              {...p}
              type="month"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setClientError(undefined);
              }}
            />
          )}
        </Field>
        <button className="btn btn-primary" type="submit" disabled={generate.busy} style={{ marginTop: 24 }}>
          {generate.busy ? "Generating…" : "Generate invoice"}
        </button>
      </form>
      {generate.error && <ErrorNotice error={generate.error} />}
      {outcome && (
        <Notice tone={outcome.created ? "success" : "info"}>
          {outcome.created ? (
            <>
              <strong>Invoice created</strong> for {formatMonth(outcome.invoice.period_start)}:{" "}
              {formatMoney(outcome.invoice.total, outcome.invoice.currency)}.
            </>
          ) : (
            <>
              <strong>Already issued.</strong> {formatMonth(outcome.invoice.period_start)} was invoiced before; this is
              the existing invoice, and nothing was recalculated.
            </>
          )}
        </Notice>
      )}

      {invoices.loading && !invoices.data && <Loading label="Loading invoices" />}
      {invoices.error && <ErrorNotice error={invoices.error} onRetry={invoices.reload} />}
      {invoices.data?.length === 0 && <Empty title="No invoices yet">Generate one for a month that has ended.</Empty>}
      {invoices.data?.map((inv) => (
        <details key={inv.id} open={outcome?.invoice.id === inv.id}>
          <summary>
            <strong>{formatMonth(inv.period_start)}</strong> — {formatMoney(inv.total, inv.currency)}
          </summary>
          <InvoiceView invoice={inv} />
        </details>
      ))}
    </section>
  );
}
