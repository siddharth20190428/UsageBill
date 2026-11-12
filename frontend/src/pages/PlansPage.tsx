import { useState } from "react";
import { api } from "../api/client";
import { IconPlus } from "../components/icons";
import { Modal } from "../components/overlay";
import { PlanCard } from "../components/PlanCard";
import { PlanForm } from "../components/PlanForm";
import { Empty, ErrorNotice, Loading, Notice, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";

export function PlansPage() {
  const plans = useAsync(() => api.listPlans(), []);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string>();

  return (
    <>
      <PageHeader
        title="Plans"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setFlash(undefined); setCreating(true); }}>
            <IconPlus /> New plan
          </button>
        }
      />
      {flash && <Notice tone="success">{flash}</Notice>}

      {plans.loading && !plans.data && <Loading label="Loading plans" />}
      {plans.error && <ErrorNotice error={plans.error} onRetry={plans.reload} />}
      {plans.data?.length === 0 && (
        <section className="panel" aria-label="Plan list">
          <div className="panel-body"><Empty title="No plans yet">Create a plan, then subscribe a customer to it.</Empty></div>
        </section>
      )}
      <div className="stack-lg">
        {plans.data?.map((p) => (
          <PlanCard key={p.id} plan={p} onChanged={plans.reload} onFlash={setFlash} />
        ))}
      </div>

      {creating && (
        <Modal title="New plan" wide onClose={() => setCreating(false)}>
          <PlanForm onCancel={() => setCreating(false)}
            onSaved={(p) => { setCreating(false); setFlash(`Created plan “${p.name}”.`); plans.reload(); }} />
        </Modal>
      )}
    </>
  );
}
