import { logger } from "./logger";

export interface GeoTick {
  lat: number;
  lng: number;
  accuracy: number | null;
  ts: number;
}

export type GeoErrorReason =
  | "unsupported"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unknown";

export interface GeoError {
  reason: GeoErrorReason;
  message: string;
}

export interface WatchHandle {
  stop: () => void;
}

/**
 * Start watching the user's position. Calls onTick on every new fix.
 * onError is called once for terminal/setup errors (e.g. permission denied).
 *
 * Returns a handle whose .stop() clears the watcher. Safe to call stop multiple times.
 */
export function startWatching(
  onTick: (tick: GeoTick) => void,
  onError: (err: GeoError) => void,
): WatchHandle {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    const err: GeoError = {
      reason: "unsupported",
      message: "Geolocation is not supported by this browser.",
    };
    logger.error("geolocation", err.message, { reason: err.reason });
    onError(err);
    return { stop: () => {} };
  }

  let stopped = false;
  let watchId: number | null = null;

  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (stopped) return;
        onTick({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          ts: pos.timestamp,
        });
      },
      (e) => {
        const reason: GeoErrorReason =
          e.code === 1 ? "permission_denied"
          : e.code === 2 ? "position_unavailable"
          : e.code === 3 ? "timeout"
          : "unknown";
        const err: GeoError = { reason, message: e.message || reason };
        logger.error("geolocation", "watchPosition error", { code: e.code, reason, message: e.message });
        onError(err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 20_000,
      },
    );
  } catch (e) {
    const err: GeoError = { reason: "unknown", message: (e as Error)?.message ?? "watchPosition threw" };
    logger.error("geolocation", "watchPosition threw", { error: e });
    onError(err);
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch (e) {
          logger.warn("geolocation", "clearWatch failed", { error: e });
        }
      }
    },
  };
}
