import { CLIENT_SHOT_COOLDOWN_MS, type InputMode, WEBCAM_HEIGHT, WEBCAM_WIDTH } from "./config";
import { GameEngine } from "./game/engine";
import { MouseInputController } from "./input/mouse";
import { createGameSocket } from "./net/socket";
import type { MatchEnd, PlayerView, WebRtcSignal } from "./types";
import { createUI } from "./ui/ui";
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
  let mouseController: MouseInputController | null = null;
  let inputMode: InputMode = "hand";
  let handAvailable = false;
  let isPlaying = false;
  let isHost = false;
  let currentAim = { x: 0.5, y: 0.5 };
  let mediaStream: MediaStream | null = null;
  let peerConnection: RTCPeerConnection | null = null;
  let remoteStream: MediaStream | null = null;
  let peerId = "";
  let pendingRemoteIce: RTCIceCandidateInit[] = [];
  let makingOffer = false;
  let cameraTestInFlight = false;
  let disposed = false;

  ui.setRemoteCameraVisible(false);
  ui.setRemoteCameraStatus("Waiting for opponent to join...");
  ui.setLocalCameraVisible(false);
  ui.setLocalCameraStatus("Camera not connected yet.");

  function clearRemoteStream(): void {
    remoteStream = null;
    ui.getRemoteWaitingVideoElement().srcObject = null;
    ui.getRemotePlayingVideoElement().srcObject = null;
    ui.setRemoteCameraVisible(false);
  }

  function clearLocalPreview(): void {
    ui.getLocalWaitingVideoElement().srcObject = null;
    ui.setLocalCameraVisible(false);
  }

  async function setLocalPreview(stream: MediaStream): Promise<void> {
    await attachStream(ui.getLocalWaitingVideoElement(), stream);
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
    if (!mediaStream) {
      mediaStream = await requestWebcamStream();
    }
    await setLocalPreview(mediaStream);
    return mediaStream;
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
  }

  function sendShoot(x = currentAim.x, y = currentAim.y): void {
    if (!roomCode) {
      return;
    }
    socket.emit("shoot", {
      roomCode,
      x: clamp01(x),
      y: clamp01(y),
      t: Date.now()
    });
  }

  function applyInputMode(requestedMode: InputMode): void {
    const mode = requestedMode === "hand" && !handAvailable ? "mouse" : requestedMode;
    inputMode = mode;
    ui.setInputMode(mode);

    handController?.setEnabled(mode === "hand");
    mouseController?.setEnabled(mode === "mouse");

    if (mode === "mouse") {
      ui.setTrackingStatus(handAvailable ? "Mouse mode active" : "Hand unavailable. Mouse mode active");
    }
  }

  async function ensureRuntimeReady(): Promise<void> {
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

    const video = ui.getVideoElement();
    try {
      const stream = await ensureMediaStream();
      await attachStream(video, stream);
      syncLocalTracksToPeer();
    } catch {
      ui.setTrackingStatus("Camera unavailable. Mouse mode active");
      handAvailable = false;
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
      if (handAvailable && !disposed) {
        handController.start(video);
      }
    }

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
      ui.setCameraTestPreviewVisible(true);
      ui.setCameraTestStatus("Camera looks good.");
    } catch {
      ui.setCameraTestPreviewVisible(false);
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
      ui.setRoomCode(roomCode);
      ui.setStatus("Room created. Waiting for player 2.");
      ui.showWaiting();
      ui.setWaitingControls({ isHost: true, canStart: false, started: false, playerCount: 1 });
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
      ui.setRoomCode(roomCode);
      ui.setStatus("Joined room. Waiting for host to start.");
      ui.showWaiting();
      ui.setWaitingControls({ isHost: false, canStart: false, started: false, playerCount: 1 });
    });
  });

  ui.onInputModeChange((mode) => {
    applyInputMode(mode);
  });

  ui.onTestCamera(() => {
    void runCameraTest();
  });

  ui.onStartMatch(() => {
    if (!roomCode) {
      return;
    }

    socket.emit("start_match", { roomCode }, (ack) => {
      if (!ack.ok) {
        ui.setStatus(`Start failed: ${ack.error}`);
        return;
      }
      ui.setStatus("Match is starting...");
    });
  });

  socket.on("connect", () => {
    ui.setStatus("Connected to server");
  });

  socket.on("disconnect", () => {
    ui.setStatus("Disconnected from server");
    teardownPeerConnection();
    ui.setRemoteCameraStatus("Disconnected from opponent camera.");
  });

  socket.on("error_event", (payload) => {
    ui.setStatus(`Error: ${payload.code}`);
    if (isPlaying) {
      ui.setTrackingStatus(`Input issue: ${payload.code}`);
    }
  });

  socket.on("room_update", (payload) => {
    roomCode = payload.roomCode;
    isHost = payload.hostId === selfPlayerId;
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
      ui.showWaiting();
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

  socket.on("match_start", async () => {
    isPlaying = true;
    ui.showPlaying();
    ui.setTimer(60_000);
    await ensureRuntimeReady();
  });

  socket.on("state_update", (payload) => {
    ui.setPlayingPlayers(payload.players, selfPlayerId);
    ui.setTimer(payload.timeRemainingMs);
    engine?.syncTargets(payload.targets);
  });

  socket.on("match_end", (payload: MatchEnd) => {
    isPlaying = false;
    ui.showResults(payload, selfPlayerId);
    ui.setTimer(0);
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
    ui.setLocalCameraStatus("Camera not connected yet.");
    ui.setRemoteCameraStatus("Waiting for opponent to join...");
  };

  const beforeUnloadHandler = () => {
    releaseMedia();
    handController?.stop();
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
  };
}
