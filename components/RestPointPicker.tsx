"use client";

import type { GeoResult, RestPoint } from "@/lib/types";
import LocationSearch from "./LocationSearch";

interface Props {
  restPoint: RestPoint | null;
  canEdit: boolean;
  picking: boolean;
  onTogglePick: () => void;
  onClear: () => void;
  onSetFromSearch: (result: GeoResult) => void;
  busy?: boolean;
}

export default function RestPointPicker({ restPoint, canEdit, picking, onTogglePick, onClear, onSetFromSearch, busy }: Props) {
  return (
    <div className="border-b border-slate-100 px-4 py-3">
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100">
            <svg className="h-3 w-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          </div>
          <span className="section-label">Destination</span>
        </div>

        {restPoint && canEdit && (
          <button type="button" onClick={onClear} disabled={busy}
            className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
            Clear
          </button>
        )}
      </div>

      {/* Current value */}
      {restPoint ? (
        <div className="mb-2.5 rounded-xl bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <div className="min-w-0 flex-1">
              {restPoint.label && (
                <div className="mb-0.5 truncate text-xs font-semibold text-emerald-800">{restPoint.label}</div>
              )}
              <div className="font-mono text-xs text-emerald-700">
                {restPoint.lat.toFixed(5)}, {restPoint.lng.toFixed(5)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-2.5 text-xs text-slate-400">
          {canEdit ? "No destination set yet." : "Host hasn't set a destination yet."}
        </div>
      )}

      {/* Edit controls */}
      {canEdit && (
        <div className="space-y-2">
          <LocationSearch placeholder="Search destination…" onSelect={onSetFromSearch} clearOnSelect={false} disabled={busy} />

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
                Tap the map to place…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
                {restPoint ? "Move on map" : "Pick on map"}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
