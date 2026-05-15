"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { logger } from "@/lib/logger";
import { generateRoomCode, normaliseRoomCode } from "@/lib/roomCode";

interface Me {
    userId: string;
    email: string | null;
    displayName: string;
}

function MapIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
        </svg>
    );
}

export default function HomeClient() {
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [loading, setLoading] = useState(true);

    const [roomName, setRoomName] = useState("");
    const [joinCode, setJoinCode] = useState("");
    const [createDestination, setCreateDestination] = useState<{
        lat: number; lng: number; label: string;
    } | null>(null);
    const [locatingDest, setLocatingDest] = useState(false);
    const [busyCreate, setBusyCreate] = useState(false);
    const [busyJoin, setBusyJoin] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const supabase = getSupabaseBrowserClient();
                const { data: u, error: uErr } = await supabase.auth.getUser();
                if (uErr || !u.user) { router.replace("/login"); return; }

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("display_name")
                    .eq("id", u.user.id)
                    .maybeSingle();

                if (cancelled) return;
                setMe({
                    userId: u.user.id,
                    email: u.user.email ?? null,
                    displayName: profile?.display_name ?? u.user.email?.split("@")[0] ?? "Friend",
                });
            } catch (e) {
                logger.error("home", "init threw", { error: e });
                setErrorMsg((e as Error)?.message ?? "Failed to load");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [router]);

    function onUseMyLocation() {
        if (!("geolocation" in navigator)) { setErrorMsg("Location not available."); return; }
        setErrorMsg(null);
        setLocatingDest(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setCreateDestination({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Trip destination" });
                setLocatingDest(false);
            },
            () => {
                setErrorMsg("Could not read your location. You can set it on the map later.");
                setLocatingDest(false);
            },
            { enableHighAccuracy: false, maximumAge: 120_000, timeout: 20_000 },
        );
    }

    async function onCreateRoom(e: React.FormEvent) {
        e.preventDefault();
        if (!me) return;
        setErrorMsg(null);
        setBusyCreate(true);
        try {
            const supabase = getSupabaseBrowserClient();
            const name = roomName.trim() || "Untitled trip";
            let createdRoomId: string | null = null;
            let lastErr: string | null = null;

            for (let attempt = 0; attempt < 5 && !createdRoomId; attempt++) {
                const code = generateRoomCode(6);
                const insertRow: { code: string; name: string; owner_id: string; rest_point?: { lat: number; lng: number; label: string } }
                    = { code, name, owner_id: me.userId };
                if (createDestination) insertRow.rest_point = createDestination;

                const { data, error } = await supabase.from("rooms").insert(insertRow).select("id, code").single();
                if (error) {
                    lastErr = error.message;
                    if (!error.message.toLowerCase().includes("duplicate")) break;
                    continue;
                }
                createdRoomId = data.id;
                setCreateDestination(null);
                const { error: memErr } = await supabase.from("room_members").insert({ room_id: data.id, user_id: me.userId });
                if (memErr && !memErr.message.toLowerCase().includes("duplicate")) {
                    setErrorMsg(memErr.message); return;
                }
            }

            if (!createdRoomId) { setErrorMsg(lastErr ?? "Could not create room."); return; }
            router.push(`/room/${createdRoomId}`);
        } catch (e) {
            setErrorMsg((e as Error)?.message ?? "Failed to create room");
        } finally {
            setBusyCreate(false);
        }
    }

    async function onJoinRoom(e: React.FormEvent) {
        e.preventDefault();
        if (!me) return;
        setErrorMsg(null);
        setBusyJoin(true);
        try {
            const supabase = getSupabaseBrowserClient();
            const code = normaliseRoomCode(joinCode);
            if (code.length < 4) { setErrorMsg("Please enter a valid room code."); return; }

            const { data: lookupRows, error } = await supabase.rpc("lookup_room_by_code", { p_code: code });
            if (error) { setErrorMsg(error.message); return; }

            const room = Array.isArray(lookupRows) ? lookupRows[0] : lookupRows;
            if (!room?.id) { setErrorMsg("No room found with that code."); return; }

            const { error: memErr } = await supabase.from("room_members").insert({ room_id: room.id, user_id: me.userId });
            if (memErr && !memErr.message.toLowerCase().includes("duplicate")) { setErrorMsg(memErr.message); return; }

            router.push(`/room/${room.id}`);
        } catch (e) {
            setErrorMsg((e as Error)?.message ?? "Failed to join room");
        } finally {
            setBusyJoin(false);
        }
    }

    async function onLogout() {
        try {
            await getSupabaseBrowserClient().auth.signOut();
            router.replace("/login");
            router.refresh();
        } catch (e) {
            logger.error("home", "signOut threw", { error: e });
        }
    }

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50">
                <div className="flex items-center gap-3 text-slate-500">
                    <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Loading...
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-brand-50/30 to-slate-100">
            {/* Header */}
            <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/80 backdrop-blur-sm"
                    style={{ paddingTop: "var(--safe-top)" }}>
                <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 shadow-sm">
                            <MapIcon className="h-4 w-4 text-white" />
                        </div>
                        <span className="text-base font-bold text-slate-900">Travel with Friends</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="hidden items-center gap-2 sm:flex">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                                {me?.displayName.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-slate-700">{me?.displayName}</span>
                        </div>
                        <button onClick={onLogout} className="flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition active:scale-95">
                            Log out
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
                {/* Hero */}
                <div className="mb-8 text-center sm:mb-10">
                    <h1 className="mb-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                        Where are you heading today?
                    </h1>
                    <p className="text-sm text-slate-500 sm:text-base">
                        Create a room and share the code — everyone sees live locations on the same map.
                    </p>
                </div>

                {errorMsg && (
                    <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                        {errorMsg}
                    </div>
                )}

                <div className="grid gap-6 md:grid-cols-2">
                    {/* Create a room */}
                    <div className="card p-6 shadow-card-md">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100">
                                <svg className="h-5 w-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-slate-900">Create a room</h2>
                                <p className="text-xs text-slate-500">You&apos;re the host</p>
                            </div>
                        </div>

                        <form onSubmit={onCreateRoom} className="space-y-4">
                            <div>
                                <label htmlFor="room_name" className="mb-1.5 block text-sm font-medium text-slate-700">
                                    Trip name
                                </label>
                                <input
                                    id="room_name"
                                    type="text"
                                    value={roomName}
                                    onChange={(e) => setRoomName(e.target.value)}
                                    placeholder="Weekend in Goa"
                                    maxLength={80}
                                    className="input-base"
                                />
                            </div>

                            {/* Destination (optional) */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="mb-2 flex items-center gap-1.5">
                                    <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                                    </svg>
                                    <span className="text-xs font-medium text-slate-600">Starting destination <span className="font-normal text-slate-400">(optional)</span></span>
                                </div>

                                {createDestination ? (
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                            <span className="font-mono">{createDestination.lat.toFixed(4)}, {createDestination.lng.toFixed(4)}</span>
                                        </div>
                                        <button type="button" onClick={() => setCreateDestination(null)}
                                                className="text-xs text-slate-500 hover:text-red-600">Remove</button>
                                    </div>
                                ) : (
                                    <button type="button" onClick={onUseMyLocation} disabled={locatingDest || busyCreate}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-60">
                                        {locatingDest ? (
                                            <>
                                                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                                </svg>
                                                Getting location…
                                            </>
                                        ) : (
                                            <>
                                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                                                </svg>
                                                Use my current location
                                            </>
                                        )}
                                    </button>
                                )}
                                <p className="mt-2 text-[11px] text-slate-400">You can also set this on the map after the room opens.</p>
                            </div>

                            <button type="submit" disabled={busyCreate} className="btn-primary w-full">
                                {busyCreate ? (
                                    <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Creating…
                  </span>
                                ) : "Create room"}
                            </button>
                        </form>
                    </div>

                    {/* Join a room */}
                    <div className="card p-6 shadow-card-md">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-slate-900">Join a room</h2>
                                <p className="text-xs text-slate-500">Enter a code from a friend</p>
                            </div>
                        </div>

                        <form onSubmit={onJoinRoom} className="space-y-4">
                            <div>
                                <label htmlFor="room_code" className="mb-1.5 block text-sm font-medium text-slate-700">
                                    Room code
                                </label>
                                <input
                                    id="room_code"
                                    type="text"
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                    placeholder="K7QXB2"
                                    maxLength={12}
                                    className="input-base text-center font-mono text-lg tracking-[0.3em] uppercase"
                                />
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                                <div className="mb-1 font-medium text-slate-600">What you&apos;ll get</div>
                                <ul className="space-y-1">
                                    <li className="flex items-center gap-1.5"><span className="text-brand-500">✓</span> Live map with everyone&apos;s location</li>
                                    <li className="flex items-center gap-1.5"><span className="text-brand-500">✓</span> Shared destination &amp; waypoint stops</li>
                                    <li className="flex items-center gap-1.5"><span className="text-brand-500">✓</span> Group chat</li>
                                </ul>
                            </div>

                            <button type="submit" disabled={busyJoin || joinCode.trim().length < 4}
                                    className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                                {busyJoin ? (
                                    <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Joining…
                  </span>
                                ) : "Join room"}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Feature strip */}
                <div className="mt-8 grid grid-cols-3 gap-3 sm:mt-10 sm:gap-4">
                    {[
                        { icon: "📍", title: "Live locations", desc: "See everyone on the map in real time" },
                        { icon: "🗺️", title: "Destination", desc: "Host sets a shared meeting point" },
                        { icon: "💬", title: "Group chat", desc: "Coordinate without switching apps" },
                    ].map((f) => (
                        <div key={f.title} className="rounded-xl border border-slate-200 bg-white/60 px-3 py-3 text-center sm:px-4">
                            <div className="mb-1 text-lg sm:text-xl">{f.icon}</div>
                            <div className="text-[11px] font-semibold text-slate-700 sm:text-xs">{f.title}</div>
                            <div className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{f.desc}</div>
                        </div>
                    ))}
                </div>
                {/* Bottom safe area spacer on mobile */}
                <div className="h-4" style={{ height: "max(1rem, var(--safe-bottom))" }} />
            </main>
        </div>
    );
}
