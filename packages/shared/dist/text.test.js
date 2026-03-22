import { describe, expect, it } from "vitest";
import { isKurdishScript, isPhoneNumber, normalizeKurdishText, normalizePhoneNumber, resolveLocalizedText } from "./text";
describe("normalizeKurdishText", () => {
    it("normalizes Arabic variants into Kurdish glyphs", () => {
        expect(normalizeKurdishText("كوردي")).toBe("کوردی");
    });
});
describe("isKurdishScript", () => {
    it("accepts Kurdish-script content", () => {
        expect(isKurdishScript("ناوی کڕیار")).toBe(true);
    });
    it("rejects latin content", () => {
        expect(isKurdishScript("customer")).toBe(false);
    });
});
describe("phone helpers", () => {
    it("normalizes phone number characters", () => {
        expect(normalizePhoneNumber("0750 123 4567")).toBe("07501234567");
    });
    it("accepts valid phone numbers", () => {
        expect(isPhoneNumber("+9647501234567")).toBe(true);
    });
});
describe("resolveLocalizedText", () => {
    it("falls back to Kurdish when locale translation is missing", () => {
        expect(resolveLocalizedText({ ku: "کولا", en: "Cola" }, "tr")).toBe("کولا");
    });
});
