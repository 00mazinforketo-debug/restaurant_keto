import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { isSessionIdle, shouldTouchSession } from "../lib/session.js";

describe("session helpers", () => {
  it("marks sessions idle after 30 minutes", () => {
    expect(isSessionIdle(dayjs().subtract(31, "minute").toDate())).toBe(true);
    expect(isSessionIdle(dayjs().subtract(29, "minute").toDate())).toBe(false);
  });

  it("throttles session touch updates to once per minute", () => {
    expect(shouldTouchSession(dayjs().subtract(61, "second").toDate())).toBe(true);
    expect(shouldTouchSession(dayjs().subtract(30, "second").toDate())).toBe(false);
  });
});
