import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Customer } from "../api/types";
import { useSubmit } from "../hooks/useSubmit";
import { formatUtc } from "../lib/dates";
import { DeleteButton, ErrorNotice, Field } from "./ui";

export function CustomerRow({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [clientError, setClientError] = useState<string>();
  const rename = useSubmit((n: string) => api.renameCustomer(customer.id, n));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setClientError("Enter a customer name.");
      return;
    }
    setClientError(undefined);
    if (await rename.run(name.trim())) {
      setEditing(false);
      onChanged();
    }
  }

  if (editing) {
    return (
      <li>
        <form className="stack" onSubmit={onSubmit} noValidate aria-label={`Rename ${customer.name}`}>
          <Field id={`rename-${customer.id}`} label="Name" error={clientError ?? rename.error?.fields.name}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
          </Field>
          {rename.error && !rename.error.fields.name && <ErrorNotice error={rename.error} />}
          <div className="row">
            <button className="btn btn-small btn-primary" type="submit" disabled={rename.busy}>
              {rename.busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setEditing(false);
                setName(customer.name);
                setClientError(undefined);
                rename.clearError();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="spread">
      <span>
        <Link to={`/customers/${customer.id}`}>{customer.name}</Link>{" "}
        <span className="muted">· created {formatUtc(customer.created_at)}</span>
      </span>
      <span className="actions">
        <button type="button" className="btn btn-small" onClick={() => setEditing(true)} aria-label={`Edit ${customer.name}`}>
          Edit
        </button>
        <DeleteButton
          what={customer.name}
          onDelete={async () => {
            await api.deleteCustomer(customer.id);
            onChanged();
          }}
        />
      </span>
    </li>
  );
}
