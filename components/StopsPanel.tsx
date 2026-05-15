"use client";

import type { GeoResult, Stop } from "@/lib/types";
import LocationSearch from "./LocationSearch";

const MAX_STOPS = 2;

interface Props {
  stops: Stop[];
  myUserId: string;
  isRoomOwner: boolean;
  picking: boolean;
  busy: boolean;
  onTogglePick: () => void;
  onAddFromSearch: (result: GeoResult) => void;
  onRemove: (stopId: string) => void;
}

export default function StopsPanel({ stops, myUserId, isRoomOwner, picking, busy, onTogglePick, onAddFromSearch, onRemove }: Props) {
  const atLimit = stops.length >= MAX_STOPS;

  return (
    <div className="border-b border-slate-100 px-4 py-3">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-100">
            <svg className="h-3 w-3 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-8 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
            </svg>
          </div>
          <span className="section-label">Stops</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${atLimit ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"}`}>
          {stops.length}/{MAX_STOPS}
        </span>
      </div>

      {/* Existing stops */}
      {stops.length > 0 ? (
        <ul className="mb-2.5 space-y-1.5">
          {stops.map((stop, i) => {
            const canDelete = stop.added_by === myUserId || isRoomOwner;
            return (
              <li key={stop.id} className="flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-2 ring-1 ring-orange-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {stop.label && (
                    <div className="truncate text-xs font-semibold text-orange-900">{stop.label}</div>
                  )}
                  <div className="font-mono text-xs text-orange-700">
                    {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                  </div>
                </div>
                {canDelete && (
                  <button type="button" onClick={() => onRemove(stop.id)} disabled={busy}
                    className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-red-100 hover:text-red-600 disabled:opacity-50">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mb-2.5 text-xs text-slate-400">No stops added yet.</div>
      )}

      {/* Add controls */}
      {!atLimit ? (
        <div className="space-y-2">
          <LocationSearch placeholder="Search a stop location…" onSelect={onAddFromSearch} clearOnSelect disabled={busy} />

          <button type="button" onClick={onTogglePick} disabled={busy}
            className={[
              "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition",
              picking
                ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300 hover:bg-amber-200"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              busy ? "opacity-60" : "",
            ].join(" ")}>
            {picking ? (
              <>
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-500" />
                Tap the map to place stop…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add stop on map
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
          Max {MAX_STOPS} stops reached — remove one to add another.
        </div>
      )}
    </div>
  );
}
