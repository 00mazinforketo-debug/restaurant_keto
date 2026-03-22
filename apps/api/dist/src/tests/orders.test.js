import { describe, expect, it } from "vitest";
import { assertOrderTransition, calculateOrderTotal } from "../lib/orders.js";
describe("order rules", () => {
    it("allows valid forward transitions", () => {
        expect(() => assertOrderTransition("PENDING", "PREPARING")).not.toThrow();
        expect(() => assertOrderTransition("READY", "DELIVERED")).not.toThrow();
    });
    it("rejects invalid transitions", () => {
        expect(() => assertOrderTransition("PENDING", "DELIVERED")).toThrow();
    });
    it("calculates order totals", () => {
        expect(calculateOrderTotal([{ quantity: 2, unitPrice: 4.5 }, { quantity: 1, unitPrice: 3 }])).toBe(12);
    });
});
