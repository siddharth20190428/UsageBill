import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Customer } from "../api/types";
import { CustomerFormModal } from "../components/CustomerFormModal";
import { IconPlus } from "../components/icons";
import { ConfirmDialog, RowMenu } from "../components/overlay";
import { Empty, ErrorNotice, Loading, Notice, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { formatUtc } from "../lib/dates";

export function CustomersPage() {
  const customers = useAsync(() => api.listCustomers(), []);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Customer>();
  const [deleting, setDeleting] = useState<Customer>();
  const [flash, setFlash] = useState<string>();

  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => { setFlash(undefined); setCreating(true); }}>
      <IconPlus /> New customer
    </button>
  );

  return (
    <>
      <PageHeader title="Customers" actions={newButton} />
      {flash && <Notice tone="success">{flash}</Notice>}

      <section className="panel" aria-label="Customer list">
        {customers.loading && !customers.data && <div className="panel-body"><Loading label="Loading customers" /></div>}
        {customers.error && <div className="panel-body"><ErrorNotice error={customers.error} onRetry={customers.reload} /></div>}
        {customers.data?.length === 0 && (
          <div className="panel-body">
            <Empty title="No customers yet">Add a customer to start recording their usage.</Empty>
          </div>
        )}
        {customers.data && customers.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Customer</th><th>Created</th><th className="col-actions"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {customers.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/customers/${c.id}`} className="cell-link">
                        <span className="avatar" aria-hidden="true">{c.name.trim().charAt(0).toUpperCase()}</span>
                        {c.name}
                      </Link>
                    </td>
                    <td className="muted">{formatUtc(c.created_at)}</td>
                    <td className="col-actions">
                      <RowMenu label={`Actions for ${c.name}`} items={[
                        { label: "Rename", onSelect: () => setRenaming(c) },
                        { label: "Delete", danger: true, onSelect: () => setDeleting(c) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <CustomerFormModal onClose={() => setCreating(false)}
          onSaved={(c) => { setFlash(`Created “${c.name}”.`); customers.reload(); }} />
      )}
      {renaming && (
        <CustomerFormModal customer={renaming} onClose={() => setRenaming(undefined)}
          onSaved={(c) => { setFlash(`Renamed to “${c.name}”.`); customers.reload(); }} />
      )}
      {deleting && (
        <ConfirmDialog title="Delete customer?" confirmLabel="Delete customer" onClose={() => setDeleting(undefined)}
          onConfirm={async () => { await api.deleteCustomer(deleting.id); setFlash(`Deleted “${deleting.name}”.`); customers.reload(); }}>
          This permanently deletes <strong>{deleting.name}</strong> and their usage and subscriptions. Customers with invoices can't be deleted.
        </ConfirmDialog>
      )}
    </>
  );
}
