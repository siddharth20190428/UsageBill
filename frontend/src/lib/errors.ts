import { ApiError, NetworkError } from "../api/client";

/** An error turned into something a person can act on. */
export interface DescribedError {
  title: string; // what happened, in plain words
  detail?: string; // the server's specific message, when it adds information
  hint?: string; // what to do next
  code?: string; // machine code, shown small so it can be quoted in a bug report
  fields: Record<string, string>; // per-field messages, keyed like the API ("tiers.0.unit_price")
}

interface Known {
  title: string;
  hint: string;
}

// One entry per error code the API can return. The point is that every failure tells the person
// what to do next, instead of "Something went wrong. Please try again."
const KNOWN: Record<string, Known> = {
  already_on_plan: {
    title: "The customer is already on this plan",
    hint: "Choose a different plan to change to.",
  },
  subscription_overlap: {
    title: "That start time overlaps the current subscription",
    hint: "A plan change must start after the current subscription began. Choose a later time.",
  },
  billing_period_closed: {
    title: "That month has already been invoiced",
    hint: "Issued invoices are final, so changes inside an invoiced month are blocked. Use a time after that month ends.",
  },
  usage_without_subscription: {
    title: "Some usage isn't covered by a subscription",
    hint: "Add or adjust a subscription so it covers that usage, then generate the invoice again.",
  },
  no_active_subscription: {
    title: "Nothing to invoice for that month",
    hint: "The customer had no subscription during that month. Pick a month the customer was subscribed.",
  },
  period_not_ended: {
    title: "That month hasn't ended yet",
    hint: "Invoices are issued after the month ends. Pick an earlier month.",
  },
  mixed_currencies: {
    title: "Two currencies in one month",
    hint: "One invoice can't mix currencies. Keep plan changes within a single currency.",
  },
  idempotency_key_reuse: {
    title: "That idempotency key was already used for a different event",
    hint: "Use a new key for a new event, or resend the original details to safely retry the old one.",
  },
  plan_name_taken: {
    title: "That plan name is already taken",
    hint: "Plans can't be edited, so give the new version a new name.",
  },
  customer_not_found: { title: "That customer no longer exists", hint: "Go back to the customer list and refresh." },
  plan_not_found: { title: "That plan no longer exists", hint: "Refresh the page and pick another plan." },
  subscription_not_found: { title: "That subscription no longer exists", hint: "Refresh the page." },
  invoice_not_found: { title: "That invoice no longer exists", hint: "Refresh the page." },
  subscription_already_ended: { title: "That subscription has already ended", hint: "Refresh to see its end time." },
  ends_at_before_start: {
    title: "The end time is before the subscription started",
    hint: "Choose an end time after the start.",
  },
  unexpected_response: {
    title: "The server sent a response we couldn't read",
    hint: "Try again in a moment. If it keeps happening, quote the details below.",
  },
};

/** FastAPI/pydantic prefix messages from custom validators with "Value error, ". Drop it. */
export function cleanValidationMessage(message: string): string {
  return message.replace(/^Value error,\s*/i, "").replace(/^./, (c) => c.toUpperCase());
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof NetworkError) {
    return {
      title: "Can't reach the server",
      hint: "Check that the API is running (uvicorn on port 8000) and that you're online, then try again.",
      fields: {},
    };
  }

  if (error instanceof ApiError) {
    const fields: Record<string, string> = {};

    if (error.code === "validation_error") {
      for (const d of error.details) {
        if (d.field && !(d.field in fields)) fields[d.field] = cleanValidationMessage(d.message);
      }
      return {
        title: "Please fix the highlighted fields",
        hint: Object.keys(fields).length === 0 ? error.message : undefined,
        code: error.code,
        fields,
      };
    }

    // Errors the API tied to one field (e.g. plan_name_taken -> "name") are shown at that field too.
    if (error.field) fields[error.field] = error.message;

    const known = KNOWN[error.code];
    if (known) {
      return {
        title: known.title,
        // The server message often has specifics (counts, dates); show it when it says more than the title.
        detail: error.message && error.message !== known.title ? error.message : undefined,
        hint: known.hint,
        code: error.code,
        fields,
      };
    }

    return {
      title: error.message || "The request failed",
      hint: "If this keeps happening, quote the code below when you report it.",
      code: `${error.code} (HTTP ${error.status})`,
      fields,
    };
  }

  return {
    title: "Something unexpected happened in the app",
    detail: error instanceof Error ? error.message : String(error),
    hint: "Reload the page. If it keeps happening, report the message above.",
    fields: {},
  };
}
