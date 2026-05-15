export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface RestPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  owner_id: string;
  /** Shared trip destination on the map; only the room owner may change it (RLS). */
  rest_point: RestPoint | null;
  created_at: string;
  ended_at: string | null;
}

export interface RoomMember {
  room_id: string;
  user_id: string;
  joined_at: string;
}

export interface LocationRow {
  room_id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

/** Broadcast payload for live location ticks on a room channel. */
export interface LocBroadcast {
  userId: string;
  displayName: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  ts: number;
}

/** Presence state we track per user in a room channel. */
export interface PresenceState {
  userId: string;
  displayName: string;
  joinedAt: number;
}

/** A waypoint stop added by any room member (max 2 per room). */
export interface Stop {
  id: string;
  room_id: string;
  added_by: string;
  lat: number;
  lng: number;
  label: string | null;
  created_at: string;
}

/** A geocoding result from Nominatim. */
export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}
