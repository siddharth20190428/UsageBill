import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import { cleanValidationMessage, describeError } from "./errors";

describe("describeError", () => {
  it("explains a network failure", () => {
    const d = describeError(new NetworkError());
    expect(d.title).toBe("Can't reach the server");
    expect(d.hint).toMatch(/uvicorn/);
  });

  it("maps validation details to fields and strips the pydantic prefix", () => {
    const d = describeError(
      new ApiError(422, "validation_error", "Invalid request", undefined, [
        { field: "tiers.1.up_to", message: "Value error, up_to must be greater than the previous tier" },
        { field: "tiers.1.up_to", message: "second message ignored" },
        { field: "name", message: "String should have at least 1 character" },
      ]),
    );
    expect(d.title).toBe("Please fix the highlighted fields");
    expect(d.fields["tiers.1.up_to"]).toBe("Up_to must be greater than the previous tier");
    expect(d.fields.name).toMatch(/at least 1/);
  });

  it("gives known codes a title and a next step, and shows the field inline", () => {
    const d = describeError(new ApiError(409, "plan_name_taken", "Plan name 'Pro' already exists", "name"));
    expect(d.title).toBe("That plan name is already taken");
    expect(d.hint).toMatch(/new name/);
    expect(d.detail).toMatch(/already exists/);
    expect(d.fields.name).toMatch(/already exists/);
  });

  it("falls back to the server message for unknown codes", () => {
    const d = describeError(new ApiError(500, "brand_new_code", "Something specific"));
    expect(d.title).toBe("Something specific");
    expect(d.code).toBe("brand_new_code (HTTP 500)");
  });

  it("handles non-API errors", () => {
    const d = describeError(new Error("boom"));
    expect(d.detail).toBe("boom");
  });

  it("cleans validation messages", () => {
    expect(cleanValidationMessage("Value error, bad thing")).toBe("Bad thing");
  });
});
