import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { InvoicesSection } from "../components/InvoicesSection";
import { SubscriptionsSection } from "../components/SubscriptionsSection";
import { UsageSection } from "../components/UsageSection";
import { ErrorNotice, Loading } from "../components/ui";
import { useAsync } from "../hooks/useAsync";

export function CustomerPage() {
  const { customerId = "" } = useParams();
  const customer = useAsync(() => api.getCustomer(customerId), [customerId]);

  return (
    <>
      <p>
        <Link to="/customers">← All customers</Link>
      </p>
      {customer.loading && !customer.data && <Loading label="Loading customer" />}
      {customer.error && <ErrorNotice error={customer.error} onRetry={customer.reload} />}
      {customer.data && (
        <>
          <h1>{customer.data.name}</h1>
          <SubscriptionsSection customerId={customerId} />
          <UsageSection customerId={customerId} />
          <InvoicesSection customerId={customerId} />
        </>
      )}
    </>
  );
}
