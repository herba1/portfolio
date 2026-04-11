"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import posthog from "posthog-js";

const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";

const EMPTY = { visitors: [], selfId: null, sendMessage: () => {}, sendTyping: () => {} };

export default function usePresence(room = "hero") {
  const [visitors, setVisitors] = useState({});
  const [selfId, setSelfId] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    // Don't connect if no host configured (production without PartyKit)
    if (!process.env.NEXT_PUBLIC_PARTYKIT_HOST) return;

    let dead = false;

    async function connect() {
      try {
        const { default: PartySocket } = await import("partysocket");
        if (dead) return;

        const ws = new PartySocket({
          host: PARTYKIT_HOST,
          room,
          maxRetries: 3,
        });

        wsRef.current = ws;

        ws.addEventListener("message", (e) => {
          try {
            const data = JSON.parse(e.data);

            if (data.type === "sync") {
              setSelfId(data.self);
              setVisitors(data.visitors);
              const count = Object.keys(data.visitors).length;
              posthog.capture("presence_connected", { visitor_count: count });
            }
            if (data.type === "join") {
              setVisitors((prev) => {
                const next = { ...prev, [data.visitor.id]: data.visitor };
                posthog.capture("presence_visitor_joined", { visitor_count: Object.keys(next).length });
                return next;
              });
            }
            if (data.type === "leave") {
              setVisitors((prev) => {
                const next = { ...prev };
                delete next[data.id];
                posthog.capture("presence_visitor_left", { visitor_count: Object.keys(next).length });
                return next;
              });
            }
            if (data.type === "message") {
              setVisitors((prev) => {
                const v = prev[data.id];
                if (!v) return prev;
                return { ...prev, [data.id]: { ...v, message: data.message, typing: false } };
              });
            }
            if (data.type === "typing") {
              setVisitors((prev) => {
                const v = prev[data.id];
                if (!v) return prev;
                return { ...prev, [data.id]: { ...v, typing: true } };
              });
            }
            if (data.type === "typing-clear") {
              setVisitors((prev) => {
                const v = prev[data.id];
                if (!v) return prev;
                return { ...prev, [data.id]: { ...v, typing: false } };
              });
            }
          } catch {
            // Bad message — ignore
          }
        });

        ws.addEventListener("close", () => {
          // Don't reset — PartySocket auto-reconnects and will re-sync.
          // Resetting causes a flash of empty → populated.
        });

        ws.addEventListener("error", () => {
          // Silently fail — ambient eyes still work
        });
      } catch {
        // Import failed or connection error — silently fail
      }
    }

    connect();

    return () => {
      dead = true;
      try { wsRef.current?.close(); } catch {}
    };
  }, [room]);

  const sendMessage = useCallback((message) => {
    try {
      wsRef.current?.send(JSON.stringify({ type: "message", message }));
      posthog.capture("presence_message_sent", { message_length: message.length });
    } catch {}
  }, []);

  const sendTyping = useCallback(() => {
    try { wsRef.current?.send(JSON.stringify({ type: "typing" })); } catch {}
  }, []);

  // All visitors including self — self shown with "you" label
  const all = Object.values(visitors);

  return { visitors: all, selfId, sendMessage, sendTyping };
}
