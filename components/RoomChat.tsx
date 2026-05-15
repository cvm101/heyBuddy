"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { logger } from "@/lib/logger";
import type { MessageRow } from "@/lib/types";

interface ChatMessage extends MessageRow {
  pending?: boolean;
}

interface ChatProps {
  roomId: string;
  myUserId: string;
  nameByUserId: Record<string, string>;
}

function avatarColor(userId: string): string {
  const palette = ["bg-violet-100 text-violet-700","bg-blue-100 text-blue-700","bg-emerald-100 text-emerald-700","bg-amber-100 text-amber-700","bg-pink-100 text-pink-700","bg-cyan-100 text-cyan-700"];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return palette[((h % palette.length) + palette.length) % palette.length];
}

export default function RoomChat({ roomId, myUserId, nameByUserId }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const { data, error } = await supabase
        .from("messages").select("*").eq("room_id", roomId)
        .order("created_at", { ascending: true }).limit(200);

      if (error) { setErrorMsg(error.message); }
      else if (!cancelled && data) { setMessages(data as ChatMessage[]); }
      if (cancelled) return;

      channel = supabase.channel(`chat:${roomId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
          (payload) => {
            const row = payload.new as MessageRow;
            setMessages((prev) => {
              const filtered = prev.filter((m) => !(m.pending && m.user_id === row.user_id && m.body === row.body));
              if (filtered.some((m) => m.id === row.id)) return filtered;
              return [...filtered, row];
            });
          })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            logger.error("chat", "realtime channel issue", { roomId, status, err: err?.message });
          }
        });

      if (cancelled && channel) { try { supabase.removeChannel(channel); } catch { /* */ } channel = null; }
    })();

    return () => {
      cancelled = true;
      if (channel) { try { supabase.removeChannel(channel); } catch { /* */ } }
    };
  }, [roomId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setErrorMsg(null);
    setSending(true);

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = { id: tempId, room_id: roomId, user_id: myUserId, body, created_at: new Date().toISOString(), pending: true };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("messages").insert({ room_id: roomId, user_id: myUserId, body });
      if (error) {
        setErrorMsg(error.message);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch (e) {
      setErrorMsg((e as Error)?.message ?? "Failed to send");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend(e as unknown as React.FormEvent);
    }
  }

  // Group consecutive messages from the same user
  const grouped = messages.reduce<Array<{ userId: string; msgs: ChatMessage[] }>>((acc, msg) => {
    const last = acc[acc.length - 1];
    if (last && last.userId === msg.user_id) { last.msgs.push(msg); }
    else { acc.push({ userId: msg.user_id, msgs: [msg] }); }
    return acc;
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
        <span className="section-label">Group chat</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-2 text-3xl">💬</div>
            <div className="text-sm font-medium text-slate-500">No messages yet</div>
            <div className="text-xs text-slate-400">Say hi to the group!</div>
          </div>
        ) : (
          grouped.map((group, gi) => {
            const mine = group.userId === myUserId;
            const name = nameByUserId[group.userId] ?? "Unknown";
            const initials = name.slice(0, 2).toUpperCase();
            const color = avatarColor(group.userId);

            return (
              <div key={gi} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar (only for others) */}
                {!mine && (
                  <div className={`mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${color}`}>
                    {initials}
                  </div>
                )}

                <div className={`flex max-w-[78%] flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
                  {/* Sender name for others */}
                  {!mine && (
                    <span className="px-1 text-[11px] font-semibold text-slate-500">{name}</span>
                  )}

                  {group.msgs.map((m, mi) => (
                    <div
                      key={m.id}
                      className={[
                        "px-3 py-2 text-sm leading-relaxed",
                        mine
                          ? "rounded-2xl rounded-br-sm bg-brand-600 text-white"
                          : "rounded-2xl rounded-bl-sm bg-white text-slate-900 ring-1 ring-slate-200",
                        m.pending ? "opacity-60" : "",
                        // Adjust corners for grouped messages
                        mi > 0 && mi < group.msgs.length - 1
                          ? mine ? "rounded-r-sm" : "rounded-l-sm"
                          : "",
                      ].join(" ")}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      {mi === group.msgs.length - 1 && (
                        <div className={`mt-0.5 text-[10px] ${mine ? "text-brand-200" : "text-slate-400"}`}>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {m.pending ? " · sending…" : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {errorMsg && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{errorMsg}</div>
      )}

      {/* Input */}
      <form onSubmit={onSend} className="flex items-center gap-2 border-t border-slate-100 bg-white p-3">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the group…"
          maxLength={2000}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:opacity-50"
        >
          <svg className="h-4 w-4 translate-x-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
          </svg>
        </button>
      </form>
    </div>
  );
}
