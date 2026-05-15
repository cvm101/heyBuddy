"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoResult } from "@/lib/types";

interface Props {
    placeholder?: string;
    onSelect: (result: GeoResult) => void;
    clearOnSelect?: boolean;
    disabled?: boolean;
}

interface NominatimResult {
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
}

async function searchNominatim(query: string): Promise<GeoResult[]> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "0");

    const res = await fetch(url.toString(), { headers: { "Accept-Language": "en" } });
    if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
    const data: NominatimResult[] = await res.json();
    return data.map((r) => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        label: r.display_name,
    }));
}

export default function LocationSearch({
                                           placeholder = "Search location…",
                                           onSelect,
                                           clearOnSelect = true,
                                           disabled,
                                       }: Props) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<GeoResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const runSearch = useCallback(async (q: string) => {
        if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
        setLoading(true);
        try {
            const res = await searchNominatim(q);
            setResults(res);
            setOpen(res.length > 0);
        } catch {
            setResults([]); setOpen(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(query), 500);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, runSearch]);

    useEffect(() => {
        function onPointerDown(e: PointerEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, []);

    function handleSelect(result: GeoResult) {
        onSelect(result);
        setOpen(false);
        if (clearOnSelect) setQuery(""); else setQuery(result.label);
    }

    return (
        <div ref={containerRef} className="relative w-full">
            {/* Input */}
            <div className="relative">
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                </div>
                <input
                    type="search"
                    inputMode="search"
                    autoCorrect="off"
                    autoCapitalize="none"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => results.length > 0 && setOpen(true)}
                    placeholder={placeholder}
                    disabled={disabled}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
                    style={{ fontSize: 16 }} /* prevent iOS zoom */
                />
                {loading && (
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
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
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-600"
                        tabIndex={-1}
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Dropdown — fixed z-index so it renders above other sidebar content */}
            {open && results.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-[9999] mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-card-lg">
                    {results.map((r, i) => (
                        <li key={i} className={i > 0 ? "border-t border-slate-100" : ""}>
                            <button
                                type="button"
                                onPointerDown={(e) => { e.preventDefault(); handleSelect(r); }}
                                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm active:bg-brand-50"
                            >
                                <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                                </svg>
                                <span className="line-clamp-2 text-slate-700">{r.label}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
