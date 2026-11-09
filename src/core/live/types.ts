export type CameraStatus = 'starting' | 'tracking' | 'absent' | 'denied' | 'error' | 'stopped' | 'stale';
export type LiveTurn = 'idle' | 'working' | 'waiting' | 'interrupted';
export type Head = { yaw: number; pitch: number; roll: number };
export type Expressions = { smile: number; browRaise: number; eyesClosed: number; mouthOpen: number };
export type UserObservation = {
  present: boolean;
  quality: { score: number; basis: 'tracking-stability' | 'unavailable' };
  position: { x: number; y: number } | null;
  head: Head | null;
  facingScreen: boolean | null;
  expression: Expressions | null;
  mouthMoving: boolean | null;
};
export type Observation = {
  v: 1; sessionId: string; seq: number; capturedAt: number;
  hands?: HandObservation; camera: CameraStatus; user: UserObservation; turn: LiveTurn; summary: string;
};
export type LiveEventKind = 'user_arrived' | 'user_left' | 'looked_away' | 'looked_back' |
  'expression_changed' | 'mouth_started' | 'mouth_stopped' | 'turn_changed';
export type LiveEvent = { id: number; type: LiveEventKind; at: number };
export type ObservationRead = { snapshot: Observation | null; receivedAt: number | null;
  ageMs: number | null; stale: boolean; events: LiveEvent[]; cursor: number; gap: boolean };

export function unavailableUser(): UserObservation {
  return { present: false, quality: { score: 0, basis: 'unavailable' }, position: null,
    head: null, facingScreen: null, expression: null, mouthMoving: null };
}

export type HandObservation = {
  v: 1; trackingState: 'tracked' | 'lost' | 'unavailable' | 'error';
  coordinateSpace: 'image-normalized'; landmarkSchema: 'mediapipe-hand-21';
  zMeaning: 'wrist-relative-image-width'; mirrored: false;
  sourceWidth: number; sourceHeight: number; primaryTrackId?: string | null;
  entities: { detectionId: number; trackId?: string; handedness: 'Left' | 'Right' | 'Unknown'; confidence: number;
    landmarks: { x: number; y: number; z: number }[] }[];
};
