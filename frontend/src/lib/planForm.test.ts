import { describe, expect, it } from "vitest";
import { emptyPlanForm, toPlanPayload, validatePlanForm, type PlanFormState } from "./planForm";

const valid = (): PlanFormState => ({
  name: " Pro ",
  currency: "USD",
  base_fee: "49",
  tiers: [
    { up_to: "1000", unit_price: "0.10" },
    { up_to: "5000", unit_price: "0.05" },
    { up_to: "", unit_price: "0.01" },
  ],
});

describe("validatePlanForm", () => {
  it("accepts a good plan", () => expect(validatePlanForm(valid())).toEqual({}));

  it("requires a name and a 3-letter uppercase currency", () => {
    const f = { ...valid(), name: "  ", currency: "us" };
    const e = validatePlanForm(f);
    expect(e.name).toBeDefined();
    expect(e.currency).toBeDefined();
  });

  it("limits base fee to 2 decimals and tier prices to 6", () => {
    const f = valid();
    f.base_fee = "1.234";
    f.tiers[0].unit_price = "0.1234567";
    const e = validatePlanForm(f);
    expect(e.base_fee).toBeDefined();
    expect(e["tiers.0.unit_price"]).toBeDefined();
  });

  it("treats a blank base fee as zero", () => {
    expect(validatePlanForm({ ...valid(), base_fee: "" })).toEqual({});
    expect(toPlanPayload({ ...valid(), base_fee: "" }).base_fee).toBe("0");
  });

  it("requires strictly ascending limits", () => {
    const f = valid();
    f.tiers[1].up_to = "1000";
    expect(validatePlanForm(f)["tiers.1.up_to"]).toMatch(/greater than/);
    f.tiers[1].up_to = "999.5";
    expect(validatePlanForm(f)["tiers.1.up_to"]).toMatch(/greater than/);
  });

  it("only the last tier may be unlimited, and it must be", () => {
    const f = valid();
    f.tiers[0].up_to = "";
    expect(validatePlanForm(f)["tiers.0.up_to"]).toMatch(/last tier/);
    const g = valid();
    g.tiers[2].up_to = "9000";
    expect(validatePlanForm(g)["tiers.2.up_to"]).toMatch(/no upper limit/);
  });

  it("rejects a zero limit", () => {
    const f = valid();
    f.tiers[0].up_to = "0";
    expect(validatePlanForm(f)["tiers.0.up_to"]).toBeDefined();
  });

  it("starts empty-but-valid-shaped: one unlimited tier needing a price", () => {
    const e = validatePlanForm({ ...emptyPlanForm(), name: "Free" });
    expect(Object.keys(e)).toEqual(["tiers.0.unit_price"]);
  });
});

describe("toPlanPayload", () => {
  it("trims and maps blank limits to null", () => {
    expect(toPlanPayload(valid())).toEqual({
      name: "Pro",
      currency: "USD",
      base_fee: "49",
      tiers: [
        { up_to: "1000", unit_price: "0.10" },
        { up_to: "5000", unit_price: "0.05" },
        { up_to: null, unit_price: "0.01" },
      ],
    });
  });
});
