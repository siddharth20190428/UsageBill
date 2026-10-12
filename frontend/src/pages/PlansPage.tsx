import { useState } from "react";
import { api } from "../api/client";
import { PlanCard } from "../components/PlanCard";
import { PlanForm } from "../components/PlanForm";
import { Empty, ErrorNotice, Loading, Notice } from "../components/ui";
import { useAsync } from "../hooks/useAsync";

export function PlansPage() {
  const plans = useAsync(() => api.listPlans(), []);
  const [created, setCreated] = useState<string>();

  return (
    <>
      <h1>Plans</h1>
      <PlanForm
        onAttempt={() => setCreated(undefined)}
        onCreated={(plan) => {
          setCreated(plan.name);
          plans.reload();
        }}
      />
      {created && <Notice tone="success">Created plan “{created}”.</Notice>}

      <section className="card" aria-label="Plan list">
        <h2>All plans</h2>
        {plans.loading && !plans.data && <Loading label="Loading plans" />}
        {plans.error && <ErrorNotice error={plans.error} onRetry={plans.reload} />}
        {plans.data?.length === 0 && <Empty title="No plans yet">Create a plan above, then subscribe a customer to it.</Empty>}
        {plans.data && plans.data.length > 0 && (
          <ul className="list">
            {plans.data.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
