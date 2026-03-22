import dayjs from "dayjs";

export const SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const SESSION_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const SESSION_TOUCH_THROTTLE_MS = 60 * 1000;

export const isSessionIdle = (lastActiveAt: Date | string) =>
  dayjs(lastActiveAt).isBefore(dayjs().subtract(SESSION_IDLE_TIMEOUT_MINUTES, "minute"));

export const shouldTouchSession = (lastActiveAt: Date | string) =>
  dayjs(lastActiveAt).isBefore(dayjs().subtract(SESSION_TOUCH_THROTTLE_MS, "millisecond"));
