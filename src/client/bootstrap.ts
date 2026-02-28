import { CLIENT_SHOT_COOLDOWN_MS, type InputMode, WEBCAM_HEIGHT, WEBCAM_WIDTH } from "./config";
import { ElevenLabsVoiceAnnouncer } from "./audio/elevenlabsVoice";
import { LocalGameAudio } from "./audio/localGameAudio";
import { GameEngine } from "./game/engine";
import { MouseInputController } from "./input/mouse";
import { createGameSocket } from "./net/socket";
import type { MatchEnd, PlayerView, WebRtcSignal } from "./types";
import { createUI } from "./ui/ui";
import { EyeInputController } from "./vision/eyes";
import { HandInputController } from "./vision/hands";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

async function attachStream(videoElement: HTMLVideoElement, stream: MediaStream): Promise<void> {
  if (videoElement.srcObject !== stream) {
    videoElement.srcObject = stream;
  }
  try {
    await videoElement.play();
  } catch {
    // Hidden videos can reject autoplay; stream attachment still succeeds.
  }
}

async function requestWebcamStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: WEBCAM_WIDTH },
      height: { ideal: WEBCAM_HEIGHT }
    },
    audio: false
  });
}

export function mountGame(appRoot: HTMLElement): () => void {
  const ui = createUI(appRoot);
  const socket = createGameSocket();

  let roomCode = "";
  let selfPlayerId = "";
  let engine: GameEngine | null = null;
  let handController: HandInputController | null = null;
  let eyeController: EyeInputController | null = null;
  let mouseController: MouseInputController | null = null;
  let inputMode: InputMode = "hand";
  let handAvailable = false;
  let eyeAvailable = false;
  let trackingVideoElement: HTMLVideoElement | null = null;
  let isPlaying = false;
  let isHost = false;
  let selectedMatchDurationSec = 60;
  let selectedRoomInputMode: InputMode = "hand";
  let currentAim = { x: 0.5, y: 0.5 };
  let lastAimSentAt = 0;
  let lastAimSentX = 0.5;
  let lastAimSentY = 0.5;
  let mediaStream: MediaStream | null = null;
  let peerConnection: RTCPeerConnection | null = null;
  let remoteStream: MediaStream | null = null;
  let peerId = "";
  let pendingRemoteIce: RTCIceCandidateInit[] = [];
  let makingOffer = false;
  let cameraTestInFlight = false;
  let cameraAutoConnectInFlight = false;
  let disposed = false;
  const voiceAnnouncer = new ElevenLabsVoiceAnnouncer();
  const localAudio = new LocalGameAudio();
  let knownPlayerIds = new Set<string>();
  let roomPlayersInitialized = false;
  let matchStartsAtMs = 0;
  let startCountdownIntervalId = 0;
  let lastStartCountdownSpoken: number | null = null;
  let lastCountdownSecondSpoken: number | null = null;
  let lastMusicSyncStartedAtMs = 0;
  let lastMusicSyncServerNowMs = 0;
  let estimatedOneWayLatencyMs = 0;
  let musicSyncProbeIntervalId = 0;

  ui.setRemoteCameraVisible(false);
  ui.setRemoteCameraStatus("Waiting for opponent to join...");
  ui.setLocalCameraVisible(false);
  ui.setLocalCameraStatus("Camera not connected yet.");
  ui.setMatchDurationSeconds(selectedMatchDurationSec);
  ui.setMatchDurationEditable(false);
  ui.setStartCountdown(null);
  ui.setInputMode(selectedRoomInputMode);
  ui.setCameraTestAim(currentAim.x, currentAim.y);
  ui.setCameraTestAimVisible(false);
  localAudio.setMenuMusicEnabled(true);

  function clearRemoteStream(): void {
    remoteStream = null;
    ui.getRemoteWaitingVideoElement().srcObject = null;
    ui.getRemotePlayingVideoElement().srcObject = null;
    ui.setRemoteCameraVisible(false);
  }

  function clearLocalPreview(): void {
    ui.getLocalWaitingVideoElement().srcObject = null;
    ui.getLocalPlayingVideoElement().srcObject = null;
    ui.setLocalCameraVisible(false);
  }

  async function setLocalPreview(stream: MediaStream): Promise<void> {
    await Promise.all([
      attachStream(ui.getLocalWaitingVideoElement(), stream),
      attachStream(ui.getLocalPlayingVideoElement(), stream)
    ]);
    ui.setLocalCameraVisible(true);
    ui.setLocalCameraStatus("Your camera connected.");
  }

  async function setRemoteStream(stream: MediaStream): Promise<void> {
    remoteStream = stream;
    await Promise.all([
      attachStream(ui.getRemoteWaitingVideoElement(), stream),
      attachStream(ui.getRemotePlayingVideoElement(), stream)
    ]);
    ui.setRemoteCameraVisible(true);
    ui.setRemoteCameraStatus("Opponent camera connected.");
  }

  async function ensureMediaStream(): Promise<MediaStream> {
    const hasLiveTrack = mediaStream?.getVideoTracks().some((track) => track.readyState === "live") ?? false;
    if (!hasLiveTrack) {
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) {
          track.stop();
        }
      }
      mediaStream = await requestWebcamStream();
    }
    const stream = mediaStream;
    if (!stream) {
      throw new Error("Camera stream unavailable");
    }
    await setLocalPreview(stream);
    return stream;
  }

  async function autoConnectCamera(): Promise<void> {
    if (cameraAutoConnectInFlight) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      ui.setLocalCameraStatus("Camera API not available in this browser.");
      return;
    }

    cameraAutoConnectInFlight = true;
    try {
      await ensureMediaStream();
    } catch {
      ui.setLocalCameraStatus("Allow camera access to auto-connect.");
      ui.setLocalCameraVisible(false);
    } finally {
      cameraAutoConnectInFlight = false;
    }
  }

  function syncLocalTracksToPeer(): void {
    if (!peerConnection || !mediaStream) {
      return;
    }

    const existingTrackIds = new Set(
      peerConnection
        .getSenders()
        .map((sender) => sender.track?.id)
        .filter((id): id is string => Boolean(id))
    );

    for (const track of mediaStream.getTracks()) {
      if (!existingTrackIds.has(track.id)) {
        peerConnection.addTrack(track, mediaStream);
      }
    }
  }

  function sendSignal(targetId: string, signal: WebRtcSignal): void {
    if (!roomCode || !targetId) {
      return;
    }
    socket.emit("webrtc_signal", {
      roomCode,
      targetId,
      signal
    });
  }

  async function flushPendingRemoteIce(): Promise<void> {
    if (!peerConnection || !peerConnection.remoteDescription || pendingRemoteIce.length === 0) {
      return;
    }

    const candidates = pendingRemoteIce;
    pendingRemoteIce = [];
    for (const candidate of candidates) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch {
        // Ignore malformed/stale candidates from previous negotiations.
      }
    }
  }

  function teardownPeerConnection(resetPeerId = true): void {
    pendingRemoteIce = [];
    makingOffer = false;

    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnection = null;
    }

    if (resetPeerId) {
      peerId = "";
    }

    clearRemoteStream();
  }

  function createPeerConnection(targetPeerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate || !peerId || peerId !== targetPeerId) {
        return;
      }
      sendSignal(targetPeerId, {
        kind: "ice",
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex
      });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        void setRemoteStream(stream);
        return;
      }

      if (!remoteStream) {
        remoteStream = new MediaStream();
      }
      remoteStream.addTrack(event.track);
      void setRemoteStream(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connecting") {
        ui.setRemoteCameraStatus("Connecting opponent camera...");
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        ui.setRemoteCameraStatus("Opponent camera unavailable.");
        ui.setRemoteCameraVisible(false);
      }
    };

    return pc;
  }

  function ensurePeerConnection(targetPeerId: string): RTCPeerConnection {
    if (peerConnection && peerId === targetPeerId) {
      return peerConnection;
    }

    teardownPeerConnection(false);
    peerId = targetPeerId;
    peerConnection = createPeerConnection(targetPeerId);
    syncLocalTracksToPeer();
    return peerConnection;
  }

  async function maybeCreateOffer(): Promise<void> {
    const pc = peerConnection;
    if (!isHost || !pc || !peerId || makingOffer) {
      return;
    }
    if (pc.signalingState !== "stable" || pc.localDescription) {
      return;
    }

    makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) {
        return;
      }
      sendSignal(peerId, { kind: "offer", sdp: offer.sdp });
      ui.setRemoteCameraStatus("Connecting opponent camera...");
    } catch {
      ui.setRemoteCameraStatus("Failed to start opponent camera.");
    } finally {
      makingOffer = false;
    }
  }

  async function ensurePeerSession(targetPeerId: string): Promise<void> {
    ensurePeerConnection(targetPeerId);
    try {
      await ensureMediaStream();
      syncLocalTracksToPeer();
    } catch {
      ui.setRemoteCameraStatus("Camera permission needed for sharing.");
      return;
    }
    await maybeCreateOffer();
  }

  function setAim(x: number, y: number): void {
    currentAim = { x: clamp01(x), y: clamp01(y) };
    engine?.setCrosshair(currentAim.x, currentAim.y);
    ui.setCameraTestAim(currentAim.x, currentAim.y);
    sendAimUpdate(currentAim.x, currentAim.y);
  }

  function sendAimUpdate(x: number, y: number, force = false): void {
    if (!roomCode) {
      return;
    }

    const aimX = clamp01(x);
    const aimY = clamp01(y);
    const now = Date.now();
    const movedEnough = Math.abs(aimX - lastAimSentX) > 0.004 || Math.abs(aimY - lastAimSentY) > 0.004;
    if (!force && now - lastAimSentAt < 40 && !movedEnough) {
      return;
    }

    lastAimSentAt = now;
    lastAimSentX = aimX;
    lastAimSentY = aimY;
    socket.emit("aim_update", {
      roomCode,
      x: aimX,
      y: aimY
    });
  }

  function sendShoot(x = currentAim.x, y = currentAim.y): void {
    if (!roomCode) {
      return;
    }
    if (matchStartsAtMs && Date.now() < matchStartsAtMs) {
      return;
    }
    sendAimUpdate(x, y, true);
    socket.emit("shoot", {
      roomCode,
      x: clamp01(x),
      y: clamp01(y),
      t: Date.now()
    });
    localAudio.playAttack();
  }

  function applyInputMode(requestedMode: InputMode): void {
    const handAvailabilityKnown = handController !== null;
    const eyeAvailabilityKnown = eyeController !== null;
    let mode: InputMode = requestedMode;
    if (requestedMode === "hand" && handAvailabilityKnown && !handAvailable) {
      mode = eyeAvailable ? "eye" : "mouse";
    } else if (requestedMode === "eye" && eyeAvailabilityKnown && !eyeAvailable) {
      mode = handAvailable ? "hand" : "mouse";
    }

    inputMode = mode;
    ui.setInputMode(mode);

    handController?.setEnabled(mode === "hand");
    eyeController?.setEnabled(mode === "eye");
    mouseController?.setEnabled(mode === "mouse");

    if (mode !== requestedMode) {
      if (requestedMode === "eye") {
        ui.setTrackingStatus(mode === "hand" ? "Eye unavailable. Hand mode active" : "Eye unavailable. Mouse mode active");
      } else if (requestedMode === "hand") {
        ui.setTrackingStatus(mode === "eye" ? "Hand unavailable. Eye mode active" : "Hand unavailable. Mouse mode active");
      }
      return;
    }

    if (mode === "mouse") {
      if (!handAvailable && !eyeAvailable) {
        ui.setTrackingStatus("Hand/Eye unavailable. Mouse mode active");
      } else {
        ui.setTrackingStatus("Mouse mode active");
      }
    }
  }

  async function ensureRuntimeReady(preferredTrackingVideo?: HTMLVideoElement): Promise<void> {
    if (!engine) {
      engine = new GameEngine(ui.getOverlayElement());
      engine.start();
      engine.setCrosshair(0.5, 0.5);
    }

    if (!mouseController) {
      mouseController = new MouseInputController(
        ui.getStageElement(),
        CLIENT_SHOT_COOLDOWN_MS,
        (x, y) => {
          if (inputMode !== "mouse") {
            return;
          }
          setAim(x, y);
        },
        (x, y) => {
          if (inputMode !== "mouse") {
            return;
          }
          sendShoot(x, y);
        }
      );
    }

    const gameplayVideo = ui.getVideoElement();
    const trackingVideo = preferredTrackingVideo ?? gameplayVideo;
    try {
      const stream = await ensureMediaStream();
      await Promise.all([
        attachStream(gameplayVideo, stream),
        trackingVideo === gameplayVideo ? Promise.resolve() : attachStream(trackingVideo, stream)
      ]);
      syncLocalTracksToPeer();
    } catch {
      ui.setTrackingStatus("Camera unavailable. Mouse mode active");
      handAvailable = false;
      eyeAvailable = false;
      applyInputMode("mouse");
      return;
    }

    if (!handController) {
      handController = new HandInputController({
        onAim: (x, y) => {
          if (inputMode !== "hand") {
            return;
          }
          setAim(x, y);
        },
        onShoot: (x, y) => {
          if (inputMode !== "hand") {
            return;
          }
          sendShoot(x, y);
        },
        onStatus: (message) => {
          if (inputMode === "hand") {
            ui.setTrackingStatus(message);
          }
        }
      });

      handAvailable = await handController.init();
    }

    if (handAvailable && !disposed && trackingVideoElement !== trackingVideo) {
      handController?.stop();
      handController?.start(trackingVideo);
    }

    if (!eyeController) {
      eyeController = new EyeInputController({
        onAim: (x, y) => {
          if (inputMode !== "eye") {
            return;
          }
          setAim(x, y);
        },
        onShoot: (x, y) => {
          if (inputMode !== "eye") {
            return;
          }
          sendShoot(x, y);
        },
        onStatus: (message) => {
          if (inputMode === "eye") {
            ui.setTrackingStatus(message);
          }
        }
      });

      eyeAvailable = await eyeController.init();
    }

    if (eyeAvailable && !disposed && trackingVideoElement !== trackingVideo) {
      eyeController?.stop();
      eyeController?.start(trackingVideo);
    }

    trackingVideoElement = trackingVideo;

    applyInputMode(inputMode);
  }

  async function runCameraTest(): Promise<void> {
    if (cameraTestInFlight) {
      return;
    }
    cameraTestInFlight = true;
    ui.setCameraTestBusy(true);
    ui.setCameraTestStatus("Requesting camera access...");

    try {
      const testVideo = ui.getCameraTestVideoElement();
      const stream = await ensureMediaStream();
      await attachStream(testVideo, stream);
      syncLocalTracksToPeer();
      await ensureRuntimeReady(testVideo);
      ui.setCameraTestPreviewVisible(true);
      ui.setCameraTestAimVisible(true);
      ui.setCameraTestStatus("Camera looks good.");
    } catch {
      ui.setCameraTestPreviewVisible(false);
      ui.setCameraTestAimVisible(false);
      ui.setCameraTestStatus("Camera unavailable or permission denied.");
      ui.setLocalCameraStatus("Camera unavailable or permission denied.");
      ui.setLocalCameraVisible(false);
    } finally {
      ui.setCameraTestBusy(false);
      cameraTestInFlight = false;
    }
  }

  function getOpponent(players: PlayerView[]): PlayerView | undefined {
    return players.find((player) => player.id !== selfPlayerId);
  }

  function greetNewPlayers(players: PlayerView[]): void {
    if (!roomPlayersInitialized) {
      roomPlayersInitialized = true;
      knownPlayerIds = new Set(players.map((player) => player.id));

      // On first full snapshot, only greet self to avoid greeting everyone in an existing room.
      const self = players.find((player) => player.id === selfPlayerId);
      if (self) {
        voiceAnnouncer.speak(`Hello ${self.name}, welcome to the room`);
      }
      return;
    }

    for (const player of players) {
      if (!knownPlayerIds.has(player.id)) {
        voiceAnnouncer.speak(`Hello ${player.name}, welcome to the room`);
      }
    }

    knownPlayerIds = new Set(players.map((player) => player.id));
  }

  function maybeSpeakCountdown(timeRemainingMs: number): void {
    const secondsRemaining = Math.ceil(Math.max(0, timeRemainingMs) / 1000);
    if (secondsRemaining < 1 || secondsRemaining > 3) {
      return;
    }
    if (lastCountdownSecondSpoken === secondsRemaining) {
      return;
    }
    lastCountdownSecondSpoken = secondsRemaining;
    voiceAnnouncer.speak(String(secondsRemaining));
  }

  function clearStartCountdown(): void {
    if (startCountdownIntervalId) {
      window.clearInterval(startCountdownIntervalId);
      startCountdownIntervalId = 0;
    }
    matchStartsAtMs = 0;
    lastStartCountdownSpoken = null;
    ui.setStartCountdown(null);
  }

  function updateStartCountdown(): void {
    if (!matchStartsAtMs) {
      ui.setStartCountdown(null);
      return;
    }

    const secondsRemaining = Math.ceil((matchStartsAtMs - Date.now()) / 1000);
    if (secondsRemaining > 0) {
      ui.setStartCountdown(secondsRemaining);
      if (lastStartCountdownSpoken !== secondsRemaining) {
        lastStartCountdownSpoken = secondsRemaining;
        voiceAnnouncer.speak(String(secondsRemaining));
      }
      return;
    }

    clearStartCountdown();
  }

  function startMatchCountdown(startTime: number): void {
    clearStartCountdown();
    matchStartsAtMs = startTime;
    updateStartCountdown();
    startCountdownIntervalId = window.setInterval(updateStartCountdown, 100);
  }

  function clearMusicProbe(): void {
    if (musicSyncProbeIntervalId) {
      window.clearInterval(musicSyncProbeIntervalId);
      musicSyncProbeIntervalId = 0;
    }
  }

  function resyncMenuMusicClock(): void {
    if (!lastMusicSyncStartedAtMs || !lastMusicSyncServerNowMs) {
      return;
    }
    localAudio.syncMenuMusicClock(lastMusicSyncStartedAtMs, lastMusicSyncServerNowMs, estimatedOneWayLatencyMs);
  }

  function probeMusicLatency(): void {
    if (!socket.connected) {
      return;
    }

    const sentAtMs = Date.now();
    socket.emit("music_sync_probe", (ack) => {
      if (!ack || typeof ack.serverNowMs !== "number") {
        return;
      }

      const rttMs = Math.max(0, Date.now() - sentAtMs);
      const halfRttMs = rttMs / 2;
      estimatedOneWayLatencyMs = estimatedOneWayLatencyMs === 0 ? halfRttMs : estimatedOneWayLatencyMs * 0.8 + halfRttMs * 0.2;
      resyncMenuMusicClock();
    });
  }

  function startMusicProbe(): void {
    clearMusicProbe();
    probeMusicLatency();
    musicSyncProbeIntervalId = window.setInterval(probeMusicLatency, 2_500);
  }

  async function reconcilePeerForRoom(players: PlayerView[]): Promise<void> {
    const opponent = getOpponent(players);
    if (!opponent) {
      teardownPeerConnection();
      ui.setRemoteCameraStatus("Waiting for opponent to join...");
      return;
    }

    if (peerId !== opponent.id) {
      teardownPeerConnection(false);
      peerId = opponent.id;
      ui.setRemoteCameraStatus("Connecting opponent camera...");
    }

    await ensurePeerSession(opponent.id);
  }

  void autoConnectCamera();

  ui.onCreateRoom((name) => {
    if (!name) {
      ui.setStatus("Name is required");
      return;
    }

    socket.emit("create_room", { name }, (ack) => {
      if ("error" in ack) {
        ui.setStatus(`Create failed: ${ack.error}`);
        return;
      }

      roomCode = ack.roomCode;
      selfPlayerId = ack.playerId;
      isHost = true;
      selectedRoomInputMode = "hand";
      ui.setInputMode(selectedRoomInputMode);
      ui.setRoomCode(roomCode);
      ui.setStatus("Room created. Waiting for player 2.");
      ui.showWaiting();
      ui.setWaitingControls({ isHost: true, canStart: false, started: false, playerCount: 1 });
      void autoConnectCamera();
    });
  });

  ui.onJoinRoom((requestedRoomCode, name) => {
    if (!name) {
      ui.setStatus("Name is required");
      return;
    }

    socket.emit("join_room", { roomCode: requestedRoomCode, name }, (ack) => {
      if (!ack.ok) {
        ui.setStatus(`Join failed: ${ack.error}`);
        return;
      }

      roomCode = ack.roomCode;
      selfPlayerId = ack.playerId;
      isHost = false;
      selectedRoomInputMode = "hand";
      ui.setInputMode(selectedRoomInputMode);
      ui.setRoomCode(roomCode);
      ui.setStatus("Joined room. Waiting for host to start.");
      ui.showWaiting();
      ui.setWaitingControls({ isHost: false, canStart: false, started: false, playerCount: 1 });
      void autoConnectCamera();
    });
  });

  ui.onInputModeChange((mode) => {
    if (isPlaying) {
      ui.setInputMode(selectedRoomInputMode);
      return;
    }
    if (!roomCode) {
      applyInputMode(mode);
      return;
    }
    if (!isHost) {
      ui.setInputMode(selectedRoomInputMode);
      return;
    }
    selectedRoomInputMode = mode;
    ui.setInputMode(selectedRoomInputMode);
    applyInputMode(mode);
  });

  ui.onMatchDurationChange((seconds) => {
    selectedMatchDurationSec = seconds;
  });

  ui.onTestCamera(() => {
    void runCameraTest();
  });

  ui.onStartMatch(() => {
    if (!roomCode) {
      return;
    }

    socket.emit(
      "start_match",
      { roomCode, durationMs: selectedMatchDurationSec * 1000, inputMode: selectedRoomInputMode },
      (ack) => {
      if (!ack.ok) {
        ui.setStatus(`Start failed: ${ack.error}`);
        return;
      }
      ui.setStatus("Match is starting...");
      }
    );
  });

  socket.on("connect", () => {
    ui.setStatus("Connected to server");
    void autoConnectCamera();
    startMusicProbe();
  });

  socket.on("music_sync", (payload) => {
    if (payload.track !== "menu") {
      return;
    }
    lastMusicSyncStartedAtMs = payload.startedAtMs;
    lastMusicSyncServerNowMs = payload.serverNowMs;
    resyncMenuMusicClock();
    probeMusicLatency();
  });

  socket.on("disconnect", () => {
    ui.setStatus("Disconnected from server");
    teardownPeerConnection();
    ui.setRemoteCameraStatus("Disconnected from opponent camera.");
    isPlaying = false;
    engine?.setOpponentCrosshairVisible(false);
    clearMusicProbe();
    clearStartCountdown();
    localAudio.setMenuMusicEnabled(true);
    knownPlayerIds.clear();
    roomPlayersInitialized = false;
    lastCountdownSecondSpoken = null;
  });

  socket.on("error_event", (payload) => {
    ui.setStatus(`Error: ${payload.code}`);
    if (isPlaying) {
      ui.setTrackingStatus(`Input issue: ${payload.code}`);
    }
  });

  socket.on("room_update", (payload) => {
    const previousRoomCode = roomCode;
    roomCode = payload.roomCode;
    if (roomCode !== previousRoomCode) {
      knownPlayerIds = new Set<string>();
      roomPlayersInitialized = false;
    }
    greetNewPlayers(payload.players);
    isHost = payload.hostId === selfPlayerId;
    if (!isHost || payload.started) {
      selectedMatchDurationSec = Math.round(payload.durationMs / 1000);
    }
    if (!isHost || payload.started) {
      selectedRoomInputMode = payload.inputMode;
      ui.setInputMode(selectedRoomInputMode);
      if (!isPlaying) {
        applyInputMode(selectedRoomInputMode);
      }
    }
    ui.setMatchDurationSeconds(selectedMatchDurationSec);
    ui.setMatchDurationEditable(isHost && !payload.started);
    ui.setRoomCode(payload.roomCode);
    ui.setWaitingPlayers(payload.players, selfPlayerId);
    ui.setPlayingPlayers(payload.players, selfPlayerId);
    ui.setWaitingControls({
      isHost,
      canStart: isHost && payload.players.length >= 2 && !payload.started,
      started: payload.started,
      playerCount: payload.players.length
    });

    if (!payload.started && !isPlaying) {
      if (isHost && payload.players.length < 2) {
        ui.setStatus("Waiting for player 2 to join.");
      } else if (isHost) {
        ui.setStatus("Both players joined. Press Start Match.");
      } else {
        ui.setStatus("Waiting for host to start the match.");
      }
    }

    if (!isPlaying) {
      clearStartCountdown();
      localAudio.setMenuMusicEnabled(true);
      ui.showWaiting();
      engine?.setOpponentCrosshairVisible(false);
      void autoConnectCamera();
    }

    void reconcilePeerForRoom(payload.players);
  });

  socket.on("webrtc_signal", (payload) => {
    if (!roomCode || payload.roomCode !== roomCode || payload.fromId === selfPlayerId) {
      return;
    }

    if (!peerId || peerId !== payload.fromId) {
      teardownPeerConnection(false);
      peerId = payload.fromId;
    }

    const pc = ensurePeerConnection(payload.fromId);

    const handleSignal = async () => {
      if (payload.signal.kind === "offer") {
        try {
          await ensureMediaStream();
          syncLocalTracksToPeer();
        } catch {
          ui.setRemoteCameraStatus("Camera permission needed for sharing.");
        }

        await pc.setRemoteDescription({ type: "offer", sdp: payload.signal.sdp });
        await flushPendingRemoteIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (answer.sdp) {
          sendSignal(payload.fromId, { kind: "answer", sdp: answer.sdp });
        }
        ui.setRemoteCameraStatus("Connecting opponent camera...");
        return;
      }

      if (payload.signal.kind === "answer") {
        if (pc.signalingState !== "have-local-offer") {
          return;
        }
        await pc.setRemoteDescription({ type: "answer", sdp: payload.signal.sdp });
        await flushPendingRemoteIce();
        return;
      }

      const candidate: RTCIceCandidateInit = {
        candidate: payload.signal.candidate,
        sdpMid: payload.signal.sdpMid ?? undefined,
        sdpMLineIndex: payload.signal.sdpMLineIndex ?? undefined
      };

      if (!pc.remoteDescription) {
        pendingRemoteIce.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate);
    };

    void handleSignal().catch(() => {
      ui.setRemoteCameraStatus("Failed to connect opponent camera.");
    });
  });

  socket.on("match_start", async (payload) => {
    isPlaying = true;
    selectedRoomInputMode = payload.inputMode;
    inputMode = payload.inputMode;
    ui.setInputMode(selectedRoomInputMode);
    lastCountdownSecondSpoken = null;
    voiceAnnouncer.prefetch(["3", "2", "1", "Game over"]);
    startMatchCountdown(payload.startTime);
    localAudio.setMenuMusicEnabled(true);
    ui.showPlaying();
    ui.setTimer(payload.durationMs);
    await ensureRuntimeReady(ui.getVideoElement());
    engine?.setOpponentCrosshairVisible(false);
    sendAimUpdate(currentAim.x, currentAim.y, true);
  });

  socket.on("state_update", (payload) => {
    ui.setPlayingPlayers(payload.players, selfPlayerId);
    ui.setTimer(payload.timeRemainingMs);
    maybeSpeakCountdown(payload.timeRemainingMs);
    engine?.syncTargets(payload.targets);
    const opponentAim = payload.aims.find((aim) => aim.id !== selfPlayerId);
    if (opponentAim) {
      engine?.setOpponentCrosshair(opponentAim.x, opponentAim.y);
      engine?.setOpponentCrosshairVisible(true);
    } else {
      engine?.setOpponentCrosshairVisible(false);
    }
  });

  socket.on("match_end", (payload: MatchEnd) => {
    isPlaying = false;
    clearStartCountdown();
    lastCountdownSecondSpoken = null;
    voiceAnnouncer.speak("Game over");
    localAudio.setMenuMusicEnabled(true);
    ui.showResults(payload, selfPlayerId);
    ui.setTimer(0);
    engine?.setOpponentCrosshairVisible(false);
    engine?.clearTargets();
  });

  const releaseMedia = () => {
    teardownPeerConnection();

    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
    ui.getVideoElement().srcObject = null;
    ui.getCameraTestVideoElement().srcObject = null;
    clearLocalPreview();
    ui.setCameraTestPreviewVisible(false);
    ui.setCameraTestAimVisible(false);
    ui.setLocalCameraStatus("Camera not connected yet.");
    ui.setRemoteCameraStatus("Waiting for opponent to join...");
  };

  const beforeUnloadHandler = () => {
    clearMusicProbe();
    clearStartCountdown();
    releaseMedia();
    handController?.stop();
    eyeController?.stop();
    mouseController?.dispose();
    engine?.dispose();
  };

  window.addEventListener("beforeunload", beforeUnloadHandler);

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;

    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler();
    socket.removeAllListeners();
    socket.disconnect();
    voiceAnnouncer.dispose();
    localAudio.dispose();
  };
}
