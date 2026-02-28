export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NAME_INVALID"
  | "MATCH_NOT_STARTED"
  | "MATCH_ENDED"
  | "INVALID_SHOT"
  | "INVALID_SETTINGS"
  | "INVALID_SIGNAL"
  | "RATE_LIMITED"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "MATCH_ALREADY_STARTED";

export type PlayerView = { id: string; name: string; score: number };
export type TargetView = { id: number; x: number; y: number; r: number };
export type AimView = { id: string; x: number; y: number };

export type CreateRoomReq = { name: string };
export type JoinRoomReq = { roomCode: string; name: string };
export type ShootReq = { roomCode: string; x: number; y: number; t?: number };
export type AimUpdateReq = { roomCode: string; x: number; y: number };
export type StartMatchReq = { roomCode: string; durationMs?: number; twoGuns?: boolean };
export type WebRtcSignalReq = {
  roomCode: string;
  targetId: string;
  signal: WebRtcSignal;
};

export type WebRtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };

export type CreateRoomAck = { roomCode: string; playerId: string } | { error: ErrorCode };
export type JoinRoomAck =
  | { ok: true; roomCode: string; playerId: string }
  | { ok: false; error: ErrorCode };
export type StartMatchAck = { ok: true } | { ok: false; error: ErrorCode };

export type RoomUpdate = {
  roomCode: string;
  players: PlayerView[];
  hostId: string;
  started: boolean;
  durationMs: number;
  twoGuns: boolean;
};
export type MatchStart = { roomCode: string; startTime: number; durationMs: number; twoGuns: boolean; countdownMs: number };
export type StateUpdate = {
  roomCode: string;
  players: PlayerView[];
  targets: TargetView[];
  aims: AimView[];
  timeRemainingMs: number;
};
export type ShotResult = {
  roomCode: string;
  shooterId: string;
  hit: boolean;
  hitTargetId?: number;
};
export type MatchEnd = {
  roomCode: string;
  finalPlayers: PlayerView[];
  winnerId?: string;
  tie: boolean;
  reason: "timeout" | "forfeit";
};
export type ErrorEvent = { code: ErrorCode; message: string };
export type WebRtcSignalEvent = {
  roomCode: string;
  fromId: string;
  signal: WebRtcSignal;
};
export type MusicSync = {
  track: "menu";
  startedAtMs: number;
  serverNowMs: number;
};
export type MusicSyncProbeAck = {
  serverNowMs: number;
};

export interface ServerToClientEvents {
  room_update: (payload: RoomUpdate) => void;
  match_start: (payload: MatchStart) => void;
  state_update: (payload: StateUpdate) => void;
  shot_result: (payload: ShotResult) => void;
  match_end: (payload: MatchEnd) => void;
  error_event: (payload: ErrorEvent) => void;
  webrtc_signal: (payload: WebRtcSignalEvent) => void;
  music_sync: (payload: MusicSync) => void;
}

export interface ClientToServerEvents {
  create_room: (payload: CreateRoomReq, cb?: (response: CreateRoomAck) => void) => void;
  join_room: (payload: JoinRoomReq, cb?: (response: JoinRoomAck) => void) => void;
  start_match: (payload: StartMatchReq, cb?: (response: StartMatchAck) => void) => void;
  shoot: (payload: ShootReq) => void;
  aim_update: (payload: AimUpdateReq) => void;
  webrtc_signal: (payload: WebRtcSignalReq) => void;
  music_sync_probe: (cb?: (payload: MusicSyncProbeAck) => void) => void;
}

export interface PlayerState {
  id: string;
  name: string;
  score: number;
}

export interface TargetState {
  id: number;
  x: number;
  y: number;
  r: number;
  alive: boolean;
}

export interface RateWindow {
  windowStartMs: number;
  count: number;
}

export interface QueuedShot {
  shooterId: string;
  x: number;
  y: number;
  receivedAt: number;
  t?: number;
}

export interface Room {
  roomCode: string;
  hostSocketId: string;
  players: Map<string, PlayerState>;
  started: boolean;
  startTime: number;
  durationMs: number;
  twoGuns: boolean;
  targets: TargetState[];
  nextTargetId: number;
  lastShotAtByPlayer: Map<string, number>;
  shotWindowCountByPlayer: Map<string, RateWindow>;
  aimByPlayer: Map<string, { x: number; y: number }>;
  pendingShots: QueuedShot[];
  tickIntervalId?: NodeJS.Timeout;
  broadcastIntervalId?: NodeJS.Timeout;
}

export interface ShotProcessResult {
  accepted: boolean;
  hit: boolean;
  shooterId: string;
  hitTargetId?: number;
  errorCode?: ErrorCode;
}
