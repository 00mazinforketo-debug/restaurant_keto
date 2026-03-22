import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { socketEvents } from "@ros/shared";
import toast from "react-hot-toast";
import { getSocket, isRealtimeEnabled } from "../lib/socket";
import { useAuth } from "./auth-provider";

const playTone = () => {
  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 720;
  gain.gain.value = 0.02;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
};

export const RealtimeBridge = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !isRealtimeEnabled()) return;
    const socket = getSocket();
    socket.connect();

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["menu"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    };

    const onEvent = () => invalidate();
    const onNotification = (payload: { message?: string }) => {
      if (payload.message) {
        toast(payload.message);
        playTone();
      }
      invalidate();
    };

    socket.on(socketEvents.orderCreated, onEvent);
    socket.on(socketEvents.orderUpdated, onEvent);
    socket.on(socketEvents.orderDeleted, onEvent);
    socket.on(socketEvents.dashboardMetrics, onEvent);
    socket.on(socketEvents.notification, onNotification);

    return () => {
      socket.off(socketEvents.orderCreated, onEvent);
      socket.off(socketEvents.orderUpdated, onEvent);
      socket.off(socketEvents.orderDeleted, onEvent);
      socket.off(socketEvents.dashboardMetrics, onEvent);
      socket.off(socketEvents.notification, onNotification);
      socket.disconnect();
    };
  }, [queryClient, user]);

  return null;
};
