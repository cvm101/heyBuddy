"use client";

import { useMemo } from "react";
import type { MapMember } from "./Map";

interface Props {
  roomMemberIds: string[];
  mapMembers: MapMember[];
  nameByUserId: Record<string, string>;
  onlineUserIds: Set<string>;
  myUserId: string;
}

function avatarColor(userId: string): string {
  const palette = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-pink-100 text-pink-700",
    "bg-cyan-100 text-cyan-700",
    "bg-indigo-100 text-indigo-700",
    "bg-rose-100 text-rose-700",
  ];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return palette[((h % palette.length) + palette.length) % palette.length];
}

export default function MemberList({ roomMemberIds, mapMembers, nameByUserId, onlineUserIds, myUserId }: Props) {
  const mapByUserId = useMemo(() => {
    const m: Record<string, MapMember> = {};
    for (const x of mapMembers) m[x.userId] = x;
    return m;
  }, [mapMembers]);

  const sortedIds = useMemo(() => {
    const ids = roomMemberIds.length > 0 ? [...roomMemberIds] : mapMembers.map((m) => m.userId);
    const uniq = [...new Set(ids)];
    uniq.sort((a, b) => {
      if (a === myUserId) return -1;
      if (b === myUserId) return 1;
      const ao = onlineUserIds.has(a) ? 0 : 1;
      const bo = onlineUserIds.has(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (nameByUserId[a] ?? "Friend").localeCompare(nameByUserId[b] ?? "Friend");
    });
    return uniq;
  }, [roomMemberIds, mapMembers, myUserId, onlineUserIds, nameByUserId]);

  const onlineCount = sortedIds.filter((id) => onlineUserIds.has(id)).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="section-label">Members</span>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs text-slate-500">
            {onlineCount} online · {sortedIds.length} total
          </span>
        </div>
      </div>

      <ul className="divide-y divide-slate-50 px-2 pb-2">
        {sortedIds.map((userId) => {
          const online = onlineUserIds.has(userId);
          const onMap = mapByUserId[userId];
          const displayName = nameByUserId[userId] ?? onMap?.displayName ?? "Friend";
          const initials = displayName.slice(0, 2).toUpperCase();
          const isMe = userId === myUserId;

          return (
            <li key={userId} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarColor(userId)}`}>
                  {initials}
                </div>
                {/* Online dot */}
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-slate-900">{displayName}</span>
                  {isMe && (
                    <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-px text-[10px] font-semibold text-brand-700">you</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-400">
                  {onMap ? (
                    online
                      ? `Live · ${new Date(onMap.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Last seen on map"
                  ) : online ? (
                    "Online · awaiting location"
                  ) : (
                    "Offline"
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
