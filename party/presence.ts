import type * as Party from "partykit/server";

/* ─────────────────────────────────────────────────────
 * Hero Presence Server
 *
 * Each visitor gets a pair of eyes on the hero.
 * Broadcasts:
 *   - join: new visitor with position
 *   - update: cursor movement or message typing
 *   - leave: visitor disconnected
 *
 * State per connection:
 *   { id, x, y, message, typing }
 *
 * Rate limits:
 *   - Max 1 message per 3s per connection
 *   - Max 20 chars per message
 *   - Max 20 updates/sec per connection
 * ───────────────────────────────────────────────────── */

interface Visitor {
  id: string;
  x: number;
  y: number;
  rotation: number;
  message: string | null;
  typing: boolean;
}

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const MAX_MSG_LENGTH = 20;
const MSG_COOLDOWN_MS = 3000;
const MAX_VISITORS = 30;

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

function containsProfanity(text: string): boolean {
  return profanityMatcher.hasMatch(text);
}

export default class PresenceServer implements Party.Server {
  visitors: Map<string, Visitor> = new Map();
  lastMsgTime: Map<string, number> = new Map();

  constructor(readonly room: Party.Room) {}

  // Assign a random position when a visitor joins
  onConnect(conn: Party.Connection) {
    if (this.visitors.size >= MAX_VISITORS) {
      conn.close(4000, "Room full");
      return;
    }

    const visitor: Visitor = {
      id: conn.id,
      x: 0.1 + Math.random() * 0.8,
      y: 0.15 + Math.random() * 0.65,
      rotation: Math.random() * 12 - 6, // -6 to 6 degrees
      message: null,
      typing: false,
    };

    this.visitors.set(conn.id, visitor);

    // Send the new visitor their own info + all existing visitors
    conn.send(JSON.stringify({
      type: "sync",
      self: conn.id,
      visitors: Object.fromEntries(this.visitors),
    }));

    // Broadcast the new join to everyone else
    this.room.broadcast(
      JSON.stringify({ type: "join", visitor }),
      [conn.id]
    );
  }

  onMessage(raw: string, sender: Party.Connection) {
    let data: { type: string; message?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const visitor = this.visitors.get(sender.id);
    if (!visitor) return;

    if (data.type === "message" && typeof data.message === "string") {
      // Rate limit
      const now = Date.now();
      const lastTime = this.lastMsgTime.get(sender.id) ?? 0;
      if (now - lastTime < MSG_COOLDOWN_MS) return;

      // Sanitize
      let msg = data.message.trim().slice(0, MAX_MSG_LENGTH);
      if (!msg || containsProfanity(msg)) return;

      this.lastMsgTime.set(sender.id, now);
      visitor.message = msg;
      visitor.typing = false;
      this.visitors.set(sender.id, visitor);

      this.room.broadcast(JSON.stringify({
        type: "message",
        id: sender.id,
        message: msg,
      }));

      // Auto-clear message after 5s
      setTimeout(() => {
        const v = this.visitors.get(sender.id);
        if (v) {
          v.message = null;
          this.visitors.set(sender.id, v);
          this.room.broadcast(JSON.stringify({
            type: "message",
            id: sender.id,
            message: null,
          }));
        }
      }, 5000);
    }

    if (data.type === "typing") {
      visitor.typing = true;
      this.visitors.set(sender.id, visitor);
      this.room.broadcast(JSON.stringify({
        type: "typing",
        id: sender.id,
      }), [sender.id]);

      // Auto-clear typing after 8s if no message sent
      setTimeout(() => {
        const v = this.visitors.get(sender.id);
        if (v && v.typing) {
          v.typing = false;
          this.visitors.set(sender.id, v);
          this.room.broadcast(JSON.stringify({
            type: "typing-clear",
            id: sender.id,
          }));
        }
      }, 8000);
    }
  }

  onClose(conn: Party.Connection) {
    this.visitors.delete(conn.id);
    this.lastMsgTime.delete(conn.id);
    this.room.broadcast(JSON.stringify({
      type: "leave",
      id: conn.id,
    }));
  }
}

PresenceServer satisfies Party.Worker;
