"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoResult } from "@/lib/types";

interface Props {
  placeholder?: string;
  onSelect: (result: GeoResult) => void;
  /** If true, the input is cleared after a selection */
  clearOnSelect?: boolean;
  disabled?: boolean;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lng: string;
  lon: string;
}

async function searchNominatim(query: string): Promise<GeoResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url.toString(), {
    headers: {
      // Nominatim usage policy requires a descriptive User-Agent
      "Accept-Language": "en",
    },
  });
  if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`);
  const data: NominatimResult[] = await res.json();
  return data.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon ?? r.lng),
    label: r.display_name,
  }));
}

export default function LocationSearch({ placeholder = "Search location…", onSelect, clearOnSelect = true, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await searchNominatim(q);
      setResults(res);
      setOpen(res.length > 0);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function handleSelect(result: GeoResult) {
    onSelect(result);
    setOpen(false);
    if (clearOnSelect) setQuery("");
    else setQuery(result.label);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 pr-8 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-60"
        />
        {loading && (
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <svg className="h-4 w-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        )}
        {!loading && query.length > 0 && (
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); setQuery(""); setResults([]); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            tabIndex={-1}
          >
            ✕
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); handleSelect(r); }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <span className="mt-0.5 shrink-0 text-slate-400">📍</span>
                <span className="line-clamp-2 text-slate-700">{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
