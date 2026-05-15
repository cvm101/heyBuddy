"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { logger } from "@/lib/logger";
import { startWatching, type WatchHandle } from "@/lib/geolocation";
import type { GeoResult, LocBroadcast, LocationRow, RestPoint, Room, Stop } from "@/lib/types";
import type { FlyToPoint, MapMember } from "./Map";

import RoomChat from "./RoomChat";
import MemberList from "./MemberList";
import RestPointPicker from "./RestPointPicker";
import StopsPanel from "./StopsPanel";

const Map = dynamic(() => import("./Map"), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">
            Loading map...
        </div>
    ),
});

const BROADCAST_INTERVAL_MS = 3_000;
const DB_UPSERT_INTERVAL_MS = 15_000;
const MAX_STOPS = 2;

interface Me {
    userId: string;
    email: string | null;
    displayName: string;
}

interface PresenceMeta {
    userId: string;
    displayName: string;
}

export default function RoomClient({ roomId }: { roomId: string }) {
    const router = useRouter();

    const [me, setMe] = useState<Me | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [geoBlocked, setGeoBlocked] = useState<string | null>(null);
    const [membersById, setMembersById] = useState<Record<string, MapMember>>({});
    const [nameByUserId, setNameByUserId] = useState<Record<string, string>>({});
    const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
    const [roomMemberIds, setRoomMemberIds] = useState<string[]>([]);
    const [pickingRestPoint, setPickingRestPoint] = useState(false);
    const [restPointBusy, setRestPointBusy] = useState(false);
    const [stops, setStops] = useState<Stop[]>([]);
    const [pickingStop, setPickingStop] = useState(false);
    const [stopBusy, setStopBusy] = useState(false);
    const [flyTo, setFlyTo] = useState<FlyToPoint | null>(null);
    const flySeqRef = useRef(0);
    const [copied, setCopied] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [mobileTab, setMobileTab] = useState<"map" | "info" | "chat">("map");

    const channelRef = useRef<RealtimeChannel | null>(null);
    const watchRef = useRef<WatchHandle | null>(null);
    const lastFixRef = useRef<{ lat: number; lng: number; accuracy: number | null; ts: number } | null>(null);
    const broadcastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const dbUpsertTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /* ----------------------------- Bootstrap ------------------------------ */

    useEffect(() => {
        let cancelled = false;
        setRoomMemberIds([]);
        (async () => {
            try {
                const supabase = getSupabaseBrowserClient();

                const { data: u, error: uErr } = await supabase.auth.getUser();
                if (uErr || !u.user) {
                    logger.warn("room", "no user, redirect to login", { error: uErr?.message });
                    router.replace("/login");
                    return;
                }

                const { data: profile, error: pErr } = await supabase
                    .from("profiles")
                    .select("display_name")
                    .eq("id", u.user.id)
                    .maybeSingle();
                if (pErr) logger.error("room", "fetch own profile failed", { error: pErr.message });

                const meResolved: Me = {
                    userId: u.user.id,
                    email: u.user.email ?? null,
                    displayName: profile?.display_name ?? u.user.email?.split("@")[0] ?? "Friend",
                };
                if (cancelled) return;
                setMe(meResolved);

                const { data: rm, error: rErr } = await supabase
                    .from("rooms")
                    .select("*")
                    .eq("id", roomId)
                    .maybeSingle();
                if (rErr) {
                    logger.error("room", "fetch room failed", { roomId, error: rErr.message });
                    setErrorMsg(rErr.message);
                    return;
                }
                if (!rm) {
                    logger.warn("room", "room not found or not accessible", { roomId });
                    setErrorMsg("Room not found, or you are not a member of it.");
                    return;
                }
                if (!cancelled) setRoom(rm as Room);

                const { data: mems, error: mErr } = await supabase
                    .from("room_members")
                    .select("user_id")
                    .eq("room_id", roomId);
                if (mErr) logger.error("room", "fetch members failed", { error: mErr.message });

                const memberIds = (mems ?? []).map((m) => m.user_id);
                if (!cancelled) setRoomMemberIds(memberIds);

                if (memberIds.length > 0) {
                    const { data: profs, error: profErr } = await supabase
                        .from("profiles")
                        .select("id, display_name")
                        .in("id", memberIds);
                    if (profErr) logger.error("room", "fetch member profiles failed", { error: profErr.message });

                    const nameMap: Record<string, string> = {};
                    for (const p of profs ?? []) nameMap[p.id] = p.display_name;
                    if (!cancelled) setNameByUserId(nameMap);
                }

                const { data: locs, error: lErr } = await supabase
                    .from("locations")
                    .select("*")
                    .eq("room_id", roomId);
                if (lErr) {
                    logger.error("room", "fetch locations failed", { error: lErr.message });
                } else if (locs && !cancelled) {
                    setMembersById((prev) => {
                        const next = { ...prev };
                        for (const l of locs as LocationRow[]) {
                            next[l.user_id] = {
                                userId: l.user_id,
                                displayName: "",
                                lat: l.lat,
                                lng: l.lng,
                                accuracy: l.accuracy,
                                isMe: l.user_id === meResolved.userId,
                                updatedAt: new Date(l.updated_at).getTime(),
                            };
                        }
                        return next;
                    });
                }

                // Fetch existing stops
                const { data: stopsData, error: stopsErr } = await supabase
                    .from("room_stops")
                    .select("*")
                    .eq("room_id", roomId)
                    .order("created_at", { ascending: true });
                if (stopsErr) {
                    logger.error("room", "fetch stops failed", { error: stopsErr.message });
                } else if (stopsData && !cancelled) {
                    setStops(stopsData as Stop[]);
                }
            } catch (e) {
                logger.error("room", "init threw", { error: e });
                setErrorMsg((e as Error)?.message ?? "Failed to load room");
            }
        })();
        return () => { cancelled = true; };
    }, [roomId, router]);

    /* ------------------- Realtime: presence + loc + rest + stops ---------- */

    useEffect(() => {
        if (!me || !room) return;
        const supabase = getSupabaseBrowserClient();

        const channel = supabase.channel(`room:${room.id}`, {
            config: {
                presence: { key: me.userId },
                broadcast: { self: false },
            },
        });

        channel
            .on("presence", { event: "sync" }, () => {
                const state = channel.presenceState() as Record<string, PresenceMeta[]>;
                const online = new Set<string>();
                const nameUpdates: Record<string, string> = {};
                for (const userId of Object.keys(state)) {
                    online.add(userId);
                    const meta = state[userId]?.[0];
                    if (meta?.displayName) nameUpdates[userId] = meta.displayName;
                }
                setOnlineUserIds(online);
                if (Object.keys(nameUpdates).length) {
                    setNameByUserId((prev) => ({ ...prev, ...nameUpdates }));
                }
            })
            .on("broadcast", { event: "loc" }, (payload) => {
                const data = payload.payload as LocBroadcast;
                if (!data?.userId) return;
                setMembersById((prev) => ({
                    ...prev,
                    [data.userId]: {
                        userId: data.userId,
                        displayName: data.displayName ?? prev[data.userId]?.displayName ?? "",
                        lat: data.lat,
                        lng: data.lng,
                        accuracy: data.accuracy,
                        isMe: data.userId === me.userId,
                        updatedAt: data.ts,
                    },
                }));
                if (data.displayName) {
                    setNameByUserId((prev) =>
                        prev[data.userId] === data.displayName ? prev : { ...prev, [data.userId]: data.displayName },
                    );
                }
            })
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
                (payload) => {
                    const next = payload.new as Room;
                    setRoom((prev) => (prev ? { ...prev, ...next } : next));
                },
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "room_members", filter: `room_id=eq.${room.id}` },
                async (payload) => {
                    const newRow = payload.new as { user_id: string };
                    setRoomMemberIds((prev) =>
                        prev.includes(newRow.user_id) ? prev : [...prev, newRow.user_id],
                    );
                    try {
                        const { data, error } = await supabase
                            .from("profiles")
                            .select("id, display_name")
                            .eq("id", newRow.user_id)
                            .maybeSingle();
                        if (error) {
                            logger.error("room", "fetch new member profile failed", { error: error.message });
                            return;
                        }
                        if (data?.display_name) {
                            setNameByUserId((prev) => ({ ...prev, [data.id]: data.display_name }));
                        }
                    } catch (e) {
                        logger.error("room", "fetch new member profile threw", { error: e });
                    }
                },
            )
            // Stops: INSERT from any member
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "room_stops", filter: `room_id=eq.${room.id}` },
                (payload) => {
                    const newStop = payload.new as Stop;
                    setStops((prev) => {
                        if (prev.some((s) => s.id === newStop.id)) return prev;
                        const updated = [...prev, newStop];
                        updated.sort((a, b) => a.created_at.localeCompare(b.created_at));
                        return updated;
                    });
                },
            )
            // Stops: DELETE
            .on(
                "postgres_changes",
                { event: "DELETE", schema: "public", table: "room_stops", filter: `room_id=eq.${room.id}` },
                (payload) => {
                    const old = payload.old as { id: string };
                    setStops((prev) => prev.filter((s) => s.id !== old.id));
                },
            )
            .subscribe(async (status, err) => {
                logger.info("room", "realtime status", { status, err: err?.message });
                if (status === "SUBSCRIBED") {
                    try {
                        await channel.track({
                            userId: me.userId,
                            displayName: me.displayName,
                            joinedAt: Date.now(),
                        } satisfies PresenceMeta & { joinedAt: number });
                    } catch (e) {
                        logger.error("room", "presence track failed", { error: e });
                    }
                } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                    logger.error("room", "realtime channel issue", { status, err: err?.message });
                }
            });

        channelRef.current = channel;

        return () => {
            try {
                supabase.removeChannel(channel);
            } catch (e) {
                logger.warn("room", "removeChannel failed", { error: e });
            }
            channelRef.current = null;
        };
    }, [me, room]);

    /* ----------------------- Geolocation + broadcast ---------------------- */

    useEffect(() => {
        if (!me || !room) return;

        const handle = startWatching(
            (tick) => {
                lastFixRef.current = { lat: tick.lat, lng: tick.lng, accuracy: tick.accuracy, ts: tick.ts };
                setMembersById((prev) => ({
                    ...prev,
                    [me.userId]: {
                        userId: me.userId,
                        displayName: me.displayName,
                        lat: tick.lat,
                        lng: tick.lng,
                        accuracy: tick.accuracy,
                        isMe: true,
                        updatedAt: tick.ts,
                    },
                }));
                setGeoBlocked(null);
            },
            (err) => {
                logger.error("room", "geolocation error", { reason: err.reason, message: err.message });
                setGeoBlocked(
                    err.reason === "permission_denied"
                        ? "Location permission denied. Enable it in your browser to share your location."
                        : err.message,
                );
            },
        );
        watchRef.current = handle;

        broadcastTimerRef.current = setInterval(() => {
            const fix = lastFixRef.current;
            const ch = channelRef.current;
            if (!fix || !ch) return;
            void Promise.resolve(
                ch.send({
                    type: "broadcast",
                    event: "loc",
                    payload: {
                        userId: me.userId,
                        displayName: me.displayName,
                        lat: fix.lat,
                        lng: fix.lng,
                        accuracy: fix.accuracy,
                        ts: fix.ts,
                    } satisfies LocBroadcast,
                }),
            ).catch((e: unknown) => logger.error("room", "broadcast send failed", { error: e }));
        }, BROADCAST_INTERVAL_MS);

        dbUpsertTimerRef.current = setInterval(async () => {
            const fix = lastFixRef.current;
            if (!fix) return;
            try {
                const supabase = getSupabaseBrowserClient();
                const { error } = await supabase
                    .from("locations")
                    .upsert(
                        {
                            room_id: room.id,
                            user_id: me.userId,
                            lat: fix.lat,
                            lng: fix.lng,
                            accuracy: fix.accuracy ?? null,
                            updated_at: new Date(fix.ts).toISOString(),
                        },
                        { onConflict: "room_id,user_id" },
                    );
                if (error) logger.error("room", "locations upsert failed", { error: error.message });
            } catch (e) {
                logger.error("room", "locations upsert threw", { error: e });
            }
        }, DB_UPSERT_INTERVAL_MS);

        return () => {
            handle.stop();
            watchRef.current = null;
            if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
            if (dbUpsertTimerRef.current) clearInterval(dbUpsertTimerRef.current);
            broadcastTimerRef.current = null;
            dbUpsertTimerRef.current = null;
        };
    }, [me, room]);

    /* ------------------------------ Actions ------------------------------- */

    const triggerFlyTo = useCallback((lat: number, lng: number) => {
        flySeqRef.current += 1;
        setFlyTo({ lat, lng, seq: flySeqRef.current });
    }, []);

    const onPickRestPoint = useCallback(
        async (lat: number, lng: number, label?: string) => {
            if (!room || !me || me.userId !== room.owner_id) return;
            setPickingRestPoint(false);
            setRestPointBusy(true);
            const next: RestPoint = { lat, lng, ...(label ? { label } : {}) };
            setRoom((prev) => (prev ? { ...prev, rest_point: next } : prev));
            try {
                const supabase = getSupabaseBrowserClient();
                const { error } = await supabase
                    .from("rooms")
                    .update({ rest_point: next })
                    .eq("id", room.id);
                if (error) {
                    logger.error("room", "set rest_point failed", { error: error.message });
                    setErrorMsg(error.message);
                } else {
                    logger.info("room", "rest_point set", { roomId: room.id, lat, lng });
                }
            } catch (e) {
                logger.error("room", "set rest_point threw", { error: e });
            } finally {
                setRestPointBusy(false);
            }
        },
        [room, me],
    );

    const onSetDestinationFromSearch = useCallback(
        async (result: GeoResult) => {
            triggerFlyTo(result.lat, result.lng);
            await onPickRestPoint(result.lat, result.lng, result.label);
        },
        [onPickRestPoint, triggerFlyTo],
    );

    const onClearRestPoint = useCallback(async () => {
        if (!room || !me || me.userId !== room.owner_id) return;
        setRestPointBusy(true);
        setRoom((prev) => (prev ? { ...prev, rest_point: null } : prev));
        try {
            const supabase = getSupabaseBrowserClient();
            const { error } = await supabase
                .from("rooms")
                .update({ rest_point: null })
                .eq("id", room.id);
            if (error) {
                logger.error("room", "clear rest_point failed", { error: error.message });
                setErrorMsg(error.message);
            }
        } catch (e) {
            logger.error("room", "clear rest_point threw", { error: e });
        } finally {
            setRestPointBusy(false);
        }
    }, [room, me]);

    const onPickStop = useCallback(
        async (lat: number, lng: number, label?: string) => {
            if (!room || !me) return;
            if (stops.length >= MAX_STOPS) return;
            setPickingStop(false);
            setStopBusy(true);
            try {
                const supabase = getSupabaseBrowserClient();
                const { data, error } = await supabase
                    .from("room_stops")
                    .insert({
                        room_id: room.id,
                        added_by: me.userId,
                        lat,
                        lng,
                        label: label ?? null,
                    })
                    .select()
                    .single();
                if (error) {
                    logger.error("room", "add stop failed", { error: error.message });
                    setErrorMsg(error.message);
                } else if (data) {
                    // Optimistic: realtime INSERT will also arrive, deduped in state handler
                    setStops((prev) => {
                        if (prev.some((s) => s.id === (data as Stop).id)) return prev;
                        return [...prev, data as Stop].sort((a, b) => a.created_at.localeCompare(b.created_at));
                    });
                    logger.info("room", "stop added", { stopId: (data as Stop).id });
                }
            } catch (e) {
                logger.error("room", "add stop threw", { error: e });
            } finally {
                setStopBusy(false);
            }
        },
        [room, me, stops],
    );

    const onAddStopFromSearch = useCallback(
        async (result: GeoResult) => {
            triggerFlyTo(result.lat, result.lng);
            await onPickStop(result.lat, result.lng, result.label);
        },
        [onPickStop, triggerFlyTo],
    );

    const onRemoveStop = useCallback(
        async (stopId: string) => {
            if (!me) return;
            setStopBusy(true);
            setStops((prev) => prev.filter((s) => s.id !== stopId));
            try {
                const supabase = getSupabaseBrowserClient();
                const { error } = await supabase
                    .from("room_stops")
                    .delete()
                    .eq("id", stopId);
                if (error) {
                    logger.error("room", "remove stop failed", { error: error.message });
                    setErrorMsg(error.message);
                }
            } catch (e) {
                logger.error("room", "remove stop threw", { error: e });
            } finally {
                setStopBusy(false);
            }
        },
        [me],
    );

    const onCopyCode = useCallback(async () => {
        if (!room) return;
        try {
            await navigator.clipboard.writeText(room.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            logger.warn("room", "clipboard copy failed", { error: e });
        }
    }, [room]);

    const onLeaveRoom = useCallback(async () => {
        if (!me || !room) return;
        if (!confirm("Leave this room?")) return;
        setLeaving(true);
        try {
            const supabase = getSupabaseBrowserClient();
            const { error } = await supabase
                .from("room_members")
                .delete()
                .eq("room_id", room.id)
                .eq("user_id", me.userId);
            if (error) {
                logger.error("room", "leave failed", { error: error.message });
                setErrorMsg(error.message);
                setLeaving(false);
                return;
            }
            logger.info("room", "left room", { roomId: room.id });
            router.push("/");
        } catch (e) {
            logger.error("room", "leave threw", { error: e });
            setLeaving(false);
        }
    }, [me, room, router]);

    /* ------------------------------ Derived ------------------------------- */

    const members: MapMember[] = useMemo(() => {
        return Object.values(membersById).map((m) => ({
            ...m,
            displayName: nameByUserId[m.userId] ?? m.displayName ?? "Friend",
        }));
    }, [membersById, nameByUserId]);

    const isRoomOwner = useMemo(
        () => !!(room && me && me.userId === room.owner_id),
        [room, me],
    );

    useEffect(() => {
        if (!isRoomOwner) setPickingRestPoint(false);
    }, [isRoomOwner]);

    /* -------------------------------- UI ---------------------------------- */

    if (errorMsg && !room) {
        return (
            <div className="flex min-h-screen items-center justify-center p-6">
                <div className="max-w-sm rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-card-md">
                    <h1 className="mb-2 text-lg font-semibold">Couldn&apos;t open room</h1>
                    <p className="mb-4 text-sm">{errorMsg}</p>
                    <button onClick={() => router.push("/")} className="btn-primary w-full">
                        Back to home
                    </button>
                </div>
            </div>
        );
    }

    if (!me || !room) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50">
                <div className="flex items-center gap-3 text-slate-500">
                    <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Loading room…
                </div>
            </div>
        );
    }

    /* ── Shared header ─────────────────────────────────── */
    const header = (
        <header className="z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2.5">
                <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition active:scale-95"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                </button>
                <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900 leading-tight">{room.name}</div>
                    <div className="flex items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-xs font-semibold tracking-widest text-slate-700">
              {room.code}
            </span>
                        <button
                            type="button"
                            onClick={onCopyCode}
                            className={`rounded px-1.5 py-px text-[11px] font-semibold transition ${copied ? "bg-emerald-100 text-emerald-700" : "text-brand-600"}`}
                        >
                            {copied ? "✓ Copied" : "Copy"}
                        </button>
                    </div>
                </div>
            </div>

            <button
                type="button"
                onClick={onLeaveRoom}
                disabled={leaving}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-xs font-semibold text-red-600 shadow-sm transition active:scale-95 disabled:opacity-60"
            >
                {leaving ? (
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                    </svg>
                )}
                <span className="hidden sm:inline">{leaving ? "Leaving…" : "Leave"}</span>
            </button>
        </header>
    );

    /* ── Banners ───────────────────────────────────────── */
    const banners = (
        <>
            {geoBlocked && (
                <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H2.645c-1.73 0-2.813-1.874-1.948-3.374L10.05 3.378c.866-1.5 3.032-1.5 3.898 0l8.355 13.498ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                    <span>{geoBlocked}</span>
                </div>
            )}
            {errorMsg && (
                <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H2.645c-1.73 0-2.813-1.874-1.948-3.374L10.05 3.378c.866-1.5 3.032-1.5 3.898 0l8.355 13.498ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                    <span>{errorMsg}</span>
                </div>
            )}
        </>
    );

    /* ── Sidebar content (shared between mobile info tab + desktop panel) ── */
    const sidebarContent = (
        <>
            <RestPointPicker
                restPoint={room.rest_point}
                canEdit={isRoomOwner}
                picking={pickingRestPoint}
                onTogglePick={() => { setPickingRestPoint((p) => !p); setMobileTab("map"); }}
                onClear={onClearRestPoint}
                onSetFromSearch={onSetDestinationFromSearch}
                busy={restPointBusy}
            />
            <StopsPanel
                stops={stops}
                myUserId={me.userId}
                isRoomOwner={isRoomOwner}
                picking={pickingStop}
                busy={stopBusy}
                onTogglePick={() => { setPickingStop((p) => !p); setMobileTab("map"); }}
                onAddFromSearch={onAddStopFromSearch}
                onRemove={onRemoveStop}
            />
            <MemberList
                roomMemberIds={roomMemberIds}
                mapMembers={members}
                nameByUserId={nameByUserId}
                onlineUserIds={onlineUserIds}
                myUserId={me.userId}
            />
        </>
    );

    /* ── Map component ─────────────────────────────────── */
    const mapComponent = (
        <Map
            members={members}
            restPoint={room.rest_point}
            stops={stops}
            pickingRestPoint={isRoomOwner && pickingRestPoint}
            pickingStop={pickingStop}
            onPickRestPoint={onPickRestPoint}
            onPickStop={onPickStop}
            flyTo={flyTo}
        />
    );

    return (
        <div className="flex h-[100dvh] flex-col bg-slate-100">
            {header}
            {banners}

            {/* ── DESKTOP layout (md+) ───────────────────────── */}
            <div className="hidden flex-1 overflow-hidden md:flex md:flex-row">
                <div className="relative flex-1">{mapComponent}</div>
                <aside className="flex w-96 flex-col border-l border-slate-200 bg-white">
                    <div className="scroll-ios flex-1 overflow-y-auto">{sidebarContent}</div>
                    <div className="flex h-72 flex-col border-t border-slate-100">
                        <RoomChat roomId={room.id} myUserId={me.userId} nameByUserId={nameByUserId} />
                    </div>
                </aside>
            </div>

            {/* ── MOBILE layout (< md) ───────────────────────── */}
            <div className="relative flex flex-1 flex-col overflow-hidden md:hidden">
                {/* Map — always mounted so GPS keeps working; hidden via CSS when not active */}
                <div className={`absolute inset-0 ${mobileTab === "map" ? "z-10" : "pointer-events-none z-0 opacity-0"}`}>
                    {mapComponent}
                </div>

                {/* Info panel */}
                {mobileTab === "info" && (
                    <div className="scroll-ios relative z-10 flex-1 overflow-y-auto bg-slate-50">
                        {sidebarContent}
                        {/* spacer so content isn't hidden behind tab bar */}
                        <div className="h-4" />
                    </div>
                )}

                {/* Chat panel */}
                {mobileTab === "chat" && (
                    <div className="relative z-10 flex flex-1 flex-col overflow-hidden bg-white">
                        <RoomChat roomId={room.id} myUserId={me.userId} nameByUserId={nameByUserId} />
                    </div>
                )}

                {/* Bottom tab bar */}
                <nav
                    className="relative z-20 flex shrink-0 items-stretch border-t border-slate-200 bg-white/95 backdrop-blur-sm"
                    style={{ paddingBottom: "var(--safe-bottom)" }}
                >
                    {(
                        [
                            {
                                id: "map",
                                label: "Map",
                                icon: (
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                                    </svg>
                                ),
                            },
                            {
                                id: "info",
                                label: "Info",
                                icon: (
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                                    </svg>
                                ),
                            },
                            {
                                id: "chat",
                                label: "Chat",
                                icon: (
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                                    </svg>
                                ),
                            },
                        ] as const
                    ).map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setMobileTab(tab.id)}
                            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                                mobileTab === tab.id
                                    ? "text-brand-600"
                                    : "text-slate-400 active:text-slate-600"
                            }`}
                        >
              <span className={`transition-transform ${mobileTab === tab.id ? "scale-110" : ""}`}>
                {tab.icon}
              </span>
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>
        </div>
    );
}
