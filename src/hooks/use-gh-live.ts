"use client";

/**
 * PlantVerse — greenhouse live stream hook («استریم زندهٔ حسگرها»).
 *
 * Subscribes to the gh-stream mini-service (socket.io on port 3004 via the
 * Caddy XTransformPort gateway) and fires `onTick` on every `gh:tick`
 * heartbeat, so the greenhouse view refetches its authoritative snapshot
 * the moment a simulation step lands — no polling latency.
 *
 * Contract:
 * - returns `live: true` while the socket is connected; the caller keeps a
 *   setTimeout polling fallback for `live === false` (offline resilience).
 * - the callback lives in a ref, so a changing callback never reconnects.
 * - `gh:hello` asks the broadcaster for an immediate first heartbeat.
 */

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export function useGhLive(onTick: () => void): boolean {
  const [live, setLive] = useState(false);
  const cbRef = useRef(onTick);

  useEffect(() => {
    cbRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    let socket: Socket | undefined;
    try {
      socket = io("/?XTransformPort=3004", {
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 6,
        reconnectionDelay: 1500,
        timeout: 8000,
      });
    } catch {
      /* io() throwing synchronously is practically unreachable — the
         connect_error handler covers every real failure mode */
      return;
    }

    const onConnect = () => {
      setLive(true);
      socket?.emit("gh:hello");
      cbRef.current();
    };
    const onTick = () => cbRef.current();
    const onDown = () => setLive(false);

    socket.on("connect", onConnect);
    socket.on("gh:tick", onTick);
    socket.on("disconnect", onDown);
    socket.on("connect_error", onDown);

    return () => {
      socket?.disconnect();
    };
  }, []);

  return live;
}
