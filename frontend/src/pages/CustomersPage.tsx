import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Empty, ErrorNotice, Field, Loading, Notice } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useSubmit } from "../hooks/useSubmit";
import { formatUtc } from "../lib/dates";

export function CustomersPage() {
  const customers = useAsync(() => api.listCustomers(), []);
  const [name, setName] = useState("");
  const [clientError, setClientError] = useState<string>();
  const [created, setCreated] = useState<string>();
  const create = useSubmit((n: string) => api.createCustomer(n));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setCreated(undefined);
    if (!name.trim()) {
      setClientError("Enter a customer name.");
      return;
    }
    setClientError(undefined);
    const customer = await create.run(name.trim());
    if (customer) {
      setName("");
      setCreated(customer.name);
      customers.reload();
    }
  }

  const fieldError = clientError ?? create.error?.fields.name;

  return (
    <>
      <h1>Customers</h1>

      <form className="card stack" onSubmit={onSubmit} noValidate aria-label="New customer">
        <h2>New customer</h2>
        <Field id="customer-name" label="Name" error={fieldError}>
          {(p) => (
            <input
              {...p}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setClientError(undefined);
              }}
              autoComplete="off"
            />
          )}
        </Field>
        {create.error && !fieldError && <ErrorNotice error={create.error} />}
        {created && <Notice tone="success">Created “{created}”.</Notice>}
        <button className="btn btn-primary" type="submit" disabled={create.busy}>
          {create.busy ? "Creating…" : "Create customer"}
        </button>
      </form>

      <section className="card" aria-label="Customer list">
        <h2>All customers</h2>
        {customers.loading && !customers.data && <Loading label="Loading customers" />}
        {customers.error && <ErrorNotice error={customers.error} onRetry={customers.reload} />}
        {customers.data?.length === 0 && (
          <Empty title="No customers yet">Create your first customer above to start recording usage.</Empty>
        )}
        {customers.data && customers.data.length > 0 && (
          <ul className="list">
            {customers.data.map((c) => (
              <li key={c.id} className="spread">
                <Link to={`/customers/${c.id}`}>{c.name}</Link>
                <span className="muted">Created {formatUtc(c.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
