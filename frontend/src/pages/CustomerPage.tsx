import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { CustomerFormModal } from "../components/CustomerFormModal";
import { InvoicesSection } from "../components/InvoicesSection";
import { ConfirmDialog, RowMenu } from "../components/overlay";
import { SubscriptionsSection } from "../components/SubscriptionsSection";
import { UsageSection } from "../components/UsageSection";
import { ErrorNotice, Loading, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";

export function CustomerPage() {
  const { customerId = "" } = useParams();
  const navigate = useNavigate();
  const customer = useAsync(() => api.getCustomer(customerId), [customerId]);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {customer.loading && !customer.data && <Loading label="Loading customer" />}
      {customer.error && (
        <>
          <p><Link to="/customers">← All customers</Link></p>
          <ErrorNotice error={customer.error} onRetry={customer.reload} />
        </>
      )}
      {customer.data && (
        <>
          <PageHeader
            title={customer.data.name}
            back={<Link to="/customers">← All customers</Link>}
            actions={
              <RowMenu label={`Actions for ${customer.data.name}`} items={[
                { label: "Rename", onSelect: () => setRenaming(true) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(true) },
              ]} />
            }
          />
          <SubscriptionsSection customerId={customerId} />
          <UsageSection customerId={customerId} />
          <InvoicesSection customerId={customerId} />

          {renaming && (
            <CustomerFormModal customer={customer.data} onClose={() => setRenaming(false)} onSaved={() => customer.reload()} />
          )}
          {deleting && (
            <ConfirmDialog title="Delete customer?" confirmLabel="Delete customer" onClose={() => setDeleting(false)}
              onConfirm={async () => { await api.deleteCustomer(customerId); navigate("/customers"); }}>
              This permanently deletes <strong>{customer.data.name}</strong> and their usage and subscriptions. Customers with invoices can't be deleted.
            </ConfirmDialog>
          )}
        </>
      )}
    </>
  );
}
