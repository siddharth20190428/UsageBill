import type { Invoice } from "../api/types";
import { formatMonth } from "../lib/dates";
import { formatMoney, formatQuantity, formatUnitPrice } from "../lib/money";

export function InvoiceView({ invoice }: { invoice: Invoice }) {
  return (
    <div className="table-wrap">
      <table aria-label={`Invoice for ${formatMonth(invoice.period_start)}`}>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Quantity</th>
            <th className="num">Unit price</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.position}>
              <td>{l.description}</td>
              <td className="num">{l.quantity === null ? "" : formatQuantity(l.quantity)}</td>
              <td className="num">{l.unit_price === null ? "" : formatUnitPrice(l.unit_price)}</td>
              <td className="num">{formatMoney(l.amount, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td className="num">{formatMoney(invoice.total, invoice.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
