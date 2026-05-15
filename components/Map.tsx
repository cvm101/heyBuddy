"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { LatLngTuple } from "leaflet";
import type { RestPoint, Stop } from "@/lib/types";

export interface MapMember {
  userId: string;
  displayName: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  isMe: boolean;
  updatedAt: number;
}

export interface FlyToPoint {
  lat: number;
  lng: number;
  /** increment this to trigger a fly-to even if lat/lng didn't change */
  seq: number;
}

export interface MapProps {
  members: MapMember[];
  restPoint: RestPoint | null;
  stops: Stop[];
  pickingRestPoint: boolean;
  pickingStop: boolean;
  onPickRestPoint: (lat: number, lng: number) => void;
  onPickStop: (lat: number, lng: number) => void;
  flyTo: FlyToPoint | null;
}

const DEFAULT_CENTER: LatLngTuple = [20, 0];
const DEFAULT_ZOOM = 2;

function makePinIcon(color: string, label: string, isMe = false): L.DivIcon {
  const ring = isMe ? "stroke=\"#1d4ed8\" stroke-width=\"3\"" : "stroke=\"white\" stroke-width=\"2\"";
  const html = `
    <div style="position:relative; transform: translate(-50%, -100%);">
      <svg width="36" height="48" viewBox="0 0 36 48" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 0C8 0 0 8 0 18c0 13 18 30 18 30s18-17 18-30C36 8 28 0 18 0z"
              fill="${color}" ${ring}/>
        <circle cx="18" cy="18" r="6" fill="white"/>
      </svg>
      <div style="
        position:absolute; left:50%; top:-6px; transform: translateX(-50%);
        background: rgba(15,23,42,0.85); color:white; font:600 11px system-ui;
        padding: 2px 6px; border-radius: 6px; white-space: nowrap;
        pointer-events: none;
      ">${escapeHtml(label)}</div>
    </div>
  `;
  return L.divIcon({ className: "tw-pin", html, iconSize: [36, 48], iconAnchor: [18, 48], popupAnchor: [0, -42] });
}

function makeRestIcon(): L.DivIcon {
  const html = `
    <div style="transform: translate(-50%, -100%);">
      <svg width="40" height="48" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 0C9 0 0 9 0 20c0 14 20 28 20 28s20-14 20-28C40 9 31 0 20 0z"
              fill="#10b981" stroke="white" stroke-width="2"/>
        <text x="20" y="26" text-anchor="middle" font-family="system-ui" font-size="18" font-weight="700" fill="white">D</text>
      </svg>
    </div>
  `;
  return L.divIcon({ className: "tw-rest", html, iconSize: [40, 48], iconAnchor: [20, 48], popupAnchor: [0, -42] });
}

function makeStopIcon(index: number): L.DivIcon {
  const label = `S${index + 1}`;
  const html = `
    <div style="transform: translate(-50%, -100%);">
      <svg width="38" height="48" viewBox="0 0 38 48" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 0C8.5 0 0 8.5 0 19c0 13.5 19 29 19 29s19-15.5 19-29C38 8.5 29.5 0 19 0z"
              fill="#f97316" stroke="white" stroke-width="2"/>
        <text x="19" y="25" text-anchor="middle" font-family="system-ui" font-size="13" font-weight="700" fill="white">${label}</text>
      </svg>
    </div>
  `;
  return L.divIcon({ className: "tw-stop", html, iconSize: [38, 48], iconAnchor: [19, 48], popupAnchor: [0, -42] });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "\"" ? "&quot;" : "&#39;",
  );
}

function colourForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue} 75% 45%)`;
}

function FitOnFirst({ members, restPoint, stops }: { members: MapMember[]; restPoint: RestPoint | null; stops: Stop[] }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    const points: LatLngTuple[] = members.map((m) => [m.lat, m.lng]);
    if (restPoint) points.push([restPoint.lat, restPoint.lng]);
    for (const s of stops) points.push([s.lat, s.lng]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14, { animate: false });
    } else {
      map.fitBounds(points, { padding: [40, 40], animate: false });
    }
    fittedRef.current = true;
  }, [members, restPoint, stops, map]);

  return null;
}

function FlyToHandler({ flyTo }: { flyTo: FlyToPoint | null }) {
  const map = useMap();
  const lastSeqRef = useRef<number>(-1);

  useEffect(() => {
    if (!flyTo) return;
    if (flyTo.seq === lastSeqRef.current) return;
    lastSeqRef.current = flyTo.seq;
    map.flyTo([flyTo.lat, flyTo.lng], 14, { animate: true, duration: 1.2 });
  }, [flyTo, map]);

  return null;
}

function ClickPicker({
  pickingRestPoint,
  pickingStop,
  onPickRestPoint,
  onPickStop,
}: {
  pickingRestPoint: boolean;
  pickingStop: boolean;
  onPickRestPoint: (lat: number, lng: number) => void;
  onPickStop: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (pickingRestPoint) onPickRestPoint(e.latlng.lat, e.latlng.lng);
      else if (pickingStop) onPickStop(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function Map({ members, restPoint, stops, pickingRestPoint, pickingStop, onPickRestPoint, onPickStop, flyTo }: MapProps) {
  const memberIcons = useMemo(() => {
    const out: Record<string, L.DivIcon> = {};
    for (const m of members) {
      out[m.userId] = makePinIcon(colourForUser(m.userId), m.displayName, m.isMe);
    }
    return out;
  }, [members]);

  const restIcon = useMemo(() => makeRestIcon(), []);
  const stopIcons = useMemo(() => stops.map((_, i) => makeStopIcon(i)), [stops]);

  const me = members.find((m) => m.isMe);
  const initialCenter: LatLngTuple = me
    ? [me.lat, me.lng]
    : restPoint
      ? [restPoint.lat, restPoint.lng]
      : members[0]
        ? [members[0].lat, members[0].lng]
        : DEFAULT_CENTER;
  const initialZoom = me || restPoint || members[0] ? 14 : DEFAULT_ZOOM;

  const isPickingAny = pickingRestPoint || pickingStop;

  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      scrollWheelZoom
      style={{ width: "100%", height: "100%", cursor: isPickingAny ? "crosshair" : "" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <FitOnFirst members={members} restPoint={restPoint} stops={stops} />
      <FlyToHandler flyTo={flyTo} />
      <ClickPicker
        pickingRestPoint={pickingRestPoint}
        pickingStop={pickingStop}
        onPickRestPoint={onPickRestPoint}
        onPickStop={onPickStop}
      />

      {members.map((m) => {
        const icon = memberIcons[m.userId];
        if (!icon) return null;
        return (
          <Marker key={m.userId} position={[m.lat, m.lng]} icon={icon}>
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">
                  {m.displayName}
                  {m.isMe ? " (you)" : ""}
                </div>
                {m.accuracy != null && (
                  <div className="text-slate-500">~{Math.round(m.accuracy)}m accuracy</div>
                )}
                <div className="text-slate-400">
                  Updated {new Date(m.updatedAt).toLocaleTimeString()}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {restPoint && (
        <Marker position={[restPoint.lat, restPoint.lng]} icon={restIcon}>
          <Popup>
            <div className="text-sm">
              <div className="font-semibold text-emerald-700">Destination</div>
              {restPoint.label && <div className="text-slate-600">{restPoint.label}</div>}
            </div>
          </Popup>
        </Marker>
      )}

      {stops.map((stop, i) => (
        <Marker key={stop.id} position={[stop.lat, stop.lng]} icon={stopIcons[i]}>
          <Popup>
            <div className="text-sm">
              <div className="font-semibold text-orange-600">Stop {i + 1}</div>
              {stop.label && <div className="text-slate-600">{stop.label}</div>}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
