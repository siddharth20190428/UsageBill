import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Customer } from "../api/types";
import { useSubmit } from "../hooks/useSubmit";
import { Modal } from "./overlay";
import { ErrorNotice, Field } from "./ui";

/** Create a customer, or rename one when `customer` is given. */
export function CustomerFormModal({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [name, setName] = useState(customer?.name ?? "");
  const [clientError, setClientError] = useState<string>();
  const save = useSubmit((n: string) => (customer ? api.renameCustomer(customer.id, n) : api.createCustomer(n)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setClientError("Enter a customer name.");
      return;
    }
    setClientError(undefined);
    const saved = await save.run(name.trim());
    if (saved) {
      onSaved(saved);
      onClose();
    }
  }

  const fieldError = clientError ?? save.error?.fields.name;
  const title = customer ? "Rename customer" : "New customer";

  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit} noValidate aria-label={customer ? `Rename ${customer.name}` : "New customer"}>
        <Field id="customer-name" label="Name" error={fieldError}>
          {(p) => (
            <input {...p} value={name} autoComplete="off"
              onChange={(e) => { setName(e.target.value); setClientError(undefined); }} />
          )}
        </Field>
        {save.error && !fieldError && <ErrorNotice error={save.error} />}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={save.busy}>
            {save.busy ? "Saving…" : customer ? "Save" : "Create customer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
