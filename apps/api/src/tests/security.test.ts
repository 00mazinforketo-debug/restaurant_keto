import { describe, expect, it } from "vitest";
import { isKurdishScript } from "@ros/shared";
import { createPinLookup, hashPin, verifyPin } from "../lib/security.js";

describe("security helpers", () => {
  it("hashes and verifies a PIN", async () => {
    const hash = await hashPin("2000");
    await expect(verifyPin("2000", hash)).resolves.toBe(true);
    await expect(verifyPin("1234", hash)).resolves.toBe(false);
  });

  it("creates a stable PIN lookup", () => {
    expect(createPinLookup("9900")).toBe(createPinLookup("9900"));
    expect(createPinLookup("9900")).not.toBe(createPinLookup("2000"));
  });

  it("validates Kurdish script input", () => {
    expect(isKurdishScript("ناوی کڕیار")).toBe(true);
    expect(isKurdishScript("Customer")).toBe(false);
  });
});
