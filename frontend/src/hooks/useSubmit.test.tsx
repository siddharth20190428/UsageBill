import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { useSubmit } from "./useSubmit";

describe("useSubmit", () => {
  it("refuses a second call while the first is in flight, even without a disabled button", async () => {
    let release!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (release = r)));
    const { result } = renderHook(() => useSubmit(fn));
    let first!: Promise<string | undefined>, second!: Promise<string | undefined>;
    act(() => {
      first = result.current.run();
      second = result.current.run();
    });
    expect(await second).toBeUndefined();
    await act(async () => {
      release("ok");
      await first;
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it("captures a failure as a described error and allows a retry", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ApiError(409, "already_on_plan", "same plan")).mockResolvedValueOnce("fine");
    const { result } = renderHook(() => useSubmit(fn));
    await act(async () => void (await result.current.run()));
    expect(result.current.error?.title).toBe("The customer is already on this plan");
    await act(async () => void (await result.current.run()));
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
