import type { PlanInput } from "../api/types";
import { compareDecimal, isDecimal, isZero } from "./money";

export interface TierRow {
  up_to: string; // blank on the last tier = unbounded
  unit_price: string;
}

export interface PlanFormState {
  name: string;
  currency: string;
  base_fee: string;
  tiers: TierRow[];
}

export const emptyPlanForm = (): PlanFormState => ({
  name: "",
  currency: "USD",
  base_fee: "0",
  tiers: [{ up_to: "", unit_price: "" }],
});

/**
 * Mirrors the server's plan rules so most mistakes are caught before a request is sent.
 * The server stays the authority: its errors are shown too, at the same field keys
 * ("name", "tiers.0.up_to", ...).
 */
export function validatePlanForm(form: PlanFormState): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!form.name.trim()) errors.name = "Enter a plan name.";
  else if (form.name.trim().length > 200) errors.name = "Keep the name under 200 characters.";

  if (!/^[A-Z]{3}$/.test(form.currency)) errors.currency = "Use a 3-letter currency code such as USD.";

  const baseFee = form.base_fee.trim() === "" ? "0" : form.base_fee.trim();
  if (!isDecimal(baseFee, 2)) errors.base_fee = "Enter an amount with at most 2 decimal places, e.g. 49.00.";

  let previous: string | null = null;
  form.tiers.forEach((tier, i) => {
    const price = tier.unit_price.trim();
    if (price === "") errors[`tiers.${i}.unit_price`] = "Enter a price per unit (0 is allowed).";
    else if (!isDecimal(price, 6)) errors[`tiers.${i}.unit_price`] = "Use a number with at most 6 decimal places.";

    const upTo = tier.up_to.trim();
    const isLast = i === form.tiers.length - 1;
    if (isLast) {
      if (upTo !== "") errors[`tiers.${i}.up_to`] = "The last tier has no upper limit. Leave this empty.";
      return;
    }
    if (upTo === "") {
      errors[`tiers.${i}.up_to`] = "Only the last tier can be unlimited. Enter where this tier ends.";
    } else if (!isDecimal(upTo, 6) || isZero(upTo)) {
      errors[`tiers.${i}.up_to`] = "Enter a positive number with at most 6 decimal places.";
    } else if (previous !== null && compareDecimal(upTo, previous) <= 0) {
      errors[`tiers.${i}.up_to`] = `Must be greater than the previous tier's limit (${previous}).`;
    } else {
      previous = upTo;
    }
  });

  return errors;
}

export function toPlanPayload(form: PlanFormState): PlanInput {
  return {
    name: form.name.trim(),
    currency: form.currency,
    base_fee: form.base_fee.trim() === "" ? "0" : form.base_fee.trim(),
    tiers: form.tiers.map((t) => ({
      up_to: t.up_to.trim() === "" ? null : t.up_to.trim(),
      unit_price: t.unit_price.trim(),
    })),
  };
}
