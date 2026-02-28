import { CLIENT_SHOT_COOLDOWN_MS, type InputMode, WEBCAM_HEIGHT, WEBCAM_WIDTH } from "./config";
import { GameEngine } from "./game/engine";
import { MouseInputController } from "./input/mouse";
import { createGameSocket } from "./net/socket";
import type { MatchEnd } from "./types";
import { createUI } from "./ui/ui";
import { HandInputController } from "./vision/hands";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

async function attachStream(videoElement: HTMLVideoElement, stream: MediaStream): Promise<void> {
  if (videoElement.srcObject !== stream) {
    videoElement.srcObject = stream;
  }
  await videoElement.play();
}

async function startWebcam(videoElement: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: WEBCAM_WIDTH },
      height: { ideal: WEBCAM_HEIGHT }
    },
    audio: false
  });

  await attachStream(videoElement, stream);
  return stream;
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
  let cameraTestInFlight = false;
  let disposed = false;

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
    if (!mediaStream) {
      try {
        mediaStream = await startWebcam(video);
      } catch {
        ui.setTrackingStatus("Camera unavailable. Mouse mode active");
        handAvailable = false;
        applyInputMode("mouse");
        return;
      }
    } else {
      try {
        await attachStream(video, mediaStream);
      } catch {
        ui.setTrackingStatus("Camera unavailable. Mouse mode active");
        handAvailable = false;
        applyInputMode("mouse");
        return;
      }
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
      if (!mediaStream) {
        mediaStream = await startWebcam(testVideo);
      } else {
        await attachStream(testVideo, mediaStream);
      }
      ui.setCameraTestPreviewVisible(true);
      ui.setCameraTestStatus("Camera looks good.");
    } catch {
      ui.setCameraTestPreviewVisible(false);
      ui.setCameraTestStatus("Camera unavailable or permission denied.");
    } finally {
      ui.setCameraTestBusy(false);
      cameraTestInFlight = false;
    }
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
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
    ui.getVideoElement().srcObject = null;
    ui.getCameraTestVideoElement().srcObject = null;
    ui.setCameraTestPreviewVisible(false);
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
