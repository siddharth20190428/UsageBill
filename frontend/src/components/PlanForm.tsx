import { useId, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Plan } from "../api/types";
import { useSubmit } from "../hooks/useSubmit";
import { emptyPlanForm, planToForm, toPlanPayload, validatePlanForm, type PlanFormState } from "../lib/planForm";
import { ErrorNotice, Field } from "./ui";

/** Create a plan, or (when `plan` is given) edit it. */
export function PlanForm({
  plan,
  onSaved,
  onAttempt,
  onCancel,
}: {
  plan?: Plan;
  onSaved: (plan: Plan) => void;
  onAttempt?: () => void;
  onCancel?: () => void;
}) {
  const editing = plan !== undefined;
  const uid = useId(); // unique per form instance: the create and edit forms can be on screen together
  const [form, setForm] = useState<PlanFormState>(() => (plan ? planToForm(plan) : emptyPlanForm()));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const create = useSubmit((f: PlanFormState) =>
    plan ? api.updatePlan(plan.id, toPlanPayload(f)) : api.createPlan(toPlanPayload(f)),
  );

  const errors = { ...(create.error?.fields ?? {}), ...clientErrors };
  const last = form.tiers.length - 1;

  function patch(next: Partial<PlanFormState>) {
    setForm((f) => ({ ...f, ...next }));
    setClientErrors({});
    create.clearError();
  }

  function patchTier(i: number, change: Partial<PlanFormState["tiers"][number]>) {
    patch({ tiers: form.tiers.map((t, j) => (j === i ? { ...t, ...change } : t)) });
  }

  function addTier() {
    // Insert before the unlimited last tier, so the last one stays last.
    patch({ tiers: [...form.tiers.slice(0, last), { up_to: "", unit_price: "" }, form.tiers[last]] });
  }

  function removeTier(i: number) {
    patch({ tiers: form.tiers.filter((_, j) => j !== i) });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    onAttempt?.();
    const found = validatePlanForm(form);
    setClientErrors(found);
    if (Object.keys(found).length > 0) return;
    const saved = await create.run(form);
    if (saved) {
      if (!editing) setForm(emptyPlanForm());
      onSaved(saved);
    }
  }

  const hasFieldErrors = Object.keys(errors).length > 0;

  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label={editing ? `Edit ${plan.name}` : "New plan"}>
      <p className="muted">
        {editing
          ? "Pricing can only be changed while no customer is subscribed to the plan; after that, only the name can change."
          : "Once a customer subscribes, a plan's pricing is locked. For new pricing, create a new plan."}
      </p>
      <div className="row">
        <Field id={`${uid}-name`} label="Name" error={errors.name}>
          {(p) => <input {...p} value={form.name} onChange={(e) => patch({ name: e.target.value })} autoComplete="off" />}
        </Field>
        <Field id={`${uid}-currency`} label="Currency" error={errors.currency}>
          {(p) => (
            <input
              {...p}
              value={form.currency}
              maxLength={3}
              onChange={(e) => patch({ currency: e.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <Field id={`${uid}-base-fee`} label="Monthly base fee" error={errors.base_fee} hint="Charged every month.">
          {(p) => <input {...p} inputMode="decimal" value={form.base_fee} onChange={(e) => patch({ base_fee: e.target.value })} />}
        </Field>
      </div>

      <fieldset className="stack">
        <legend>
          <h3>Pricing tiers</h3>
        </legend>
        <p className="muted">
          Graduated: each unit is priced by the tier it falls in. “Up to” is the cumulative quantity where a tier ends;
          the last tier has no limit.
        </p>
        {form.tiers.map((tier, i) => (
          <div className="tier-row" key={i}>
            <Field
              id={`${uid}-tier-${i}-up-to`}
              label={`Tier ${i + 1} up to`}
              error={errors[`tiers.${i}.up_to`]}
              hint={i === last ? "No limit" : undefined}
            >
              {(p) => (
                <input
                  {...p}
                  inputMode="decimal"
                  value={tier.up_to}
                  disabled={i === last}
                  placeholder={i === last ? "∞" : "e.g. 1000"}
                  onChange={(e) => patchTier(i, { up_to: e.target.value })}
                />
              )}
            </Field>
            <Field id={`${uid}-tier-${i}-price`} label={`Tier ${i + 1} price per unit`} error={errors[`tiers.${i}.unit_price`]}>
              {(p) => (
                <input
                  {...p}
                  inputMode="decimal"
                  value={tier.unit_price}
                  placeholder="e.g. 0.10"
                  onChange={(e) => patchTier(i, { unit_price: e.target.value })}
                />
              )}
            </Field>
            {form.tiers.length > 1 && i !== last ? (
              <button type="button" className="btn btn-small remove" onClick={() => removeTier(i)}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-small" onClick={addTier}>
            Add tier
          </button>
        </div>
      </fieldset>

      {create.error && (!hasFieldErrors || create.error.code !== "validation_error") && (
        <ErrorNotice error={create.error} />
      )}
      {Object.keys(clientErrors).length > 0 && (
        <div className="notice notice-error" role="alert">
          <strong>Please fix the highlighted fields</strong>
        </div>
      )}
      <div className="modal-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" type="submit" disabled={create.busy}>
          {create.busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create plan"}
        </button>
      </div>
    </form>
  );
}
