import type { InputMode } from "../config";
import type { MatchEnd, PlayerView } from "../types";

type ScreenId = "lobby" | "waiting" | "playing" | "results";

export interface UIController {
  onCreateRoom(handler: (name: string) => void): void;
  onJoinRoom(handler: (roomCode: string, name: string) => void): void;
  onStartMatch(handler: () => void): void;
  onTestCamera(handler: () => void): void;
  onInputModeChange(handler: (mode: InputMode) => void): void;
  onMatchDurationChange(handler: (seconds: number) => void): void;
  setStatus(message: string): void;
  setCameraTestStatus(message: string): void;
  setCameraTestPreviewVisible(visible: boolean): void;
  setCameraTestBusy(isBusy: boolean): void;
  setCameraTestAim(x: number, y: number): void;
  setCameraTestAimVisible(visible: boolean): void;
  setLocalCameraStatus(message: string): void;
  setLocalCameraVisible(visible: boolean): void;
  setRemoteCameraStatus(message: string): void;
  setRemoteCameraVisible(visible: boolean): void;
  setMatchDurationSeconds(seconds: number): void;
  setMatchDurationEditable(editable: boolean): void;
  setRoomCode(roomCode: string): void;
  setWaitingPlayers(players: PlayerView[], selfId?: string): void;
  setPlayingPlayers(players: PlayerView[], selfId?: string): void;
  setTimer(timeRemainingMs: number): void;
  setStartCountdown(secondsRemaining: number | null): void;
  setTrackingStatus(message: string): void;
  setInputMode(mode: InputMode): void;
  setWaitingControls(params: { isHost: boolean; canStart: boolean; started: boolean; playerCount: number }): void;
  showLobby(): void;
  showWaiting(): void;
  showPlaying(): void;
  showResults(payload: MatchEnd, selfId?: string): void;
  getVideoElement(): HTMLVideoElement;
  getCameraTestVideoElement(): HTMLVideoElement;
  getLocalWaitingVideoElement(): HTMLVideoElement;
  getLocalPlayingVideoElement(): HTMLVideoElement;
  getRemoteWaitingVideoElement(): HTMLVideoElement;
  getRemotePlayingVideoElement(): HTMLVideoElement;
  getOverlayElement(): HTMLDivElement;
  getStageElement(): HTMLDivElement;
}

function renderPlayers(container: HTMLUListElement, players: PlayerView[], selfId?: string): void {
  container.innerHTML = "";
  for (const player of players) {
    const li = document.createElement("li");
    const isSelf = player.id === selfId;
    li.className = `player-item${isSelf ? " self" : ""}`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = player.name;

    if (isSelf) {
      const selfTag = document.createElement("em");
      selfTag.textContent = " (You)";
      nameSpan.appendChild(selfTag);
    }

    const scoreSpan = document.createElement("span");
    scoreSpan.className = "player-score";
    scoreSpan.textContent = String(player.score);

    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    container.appendChild(li);
  }
}

function formatTimer(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function createUI(root: HTMLElement): UIController {
  root.innerHTML = `
    <div class="app-shell">
      <section id="screen-lobby" class="screen panel active">
        <div class="panel-header">Mission Setup</div>
        <h1 class="title">Gesture Shooter</h1>
        <p class="subtitle">2 players • server-authoritative • fantasy arcade vibe</p>

        <div class="form-block">
          <label for="player-name">Player Name</label>
          <div class="row">
            <input id="player-name" placeholder="Sharpshooter" maxlength="20" />
          </div>
        </div>

        <div class="form-block">
          <label for="join-room-code">Room Code</label>
          <div class="row">
            <input id="join-room-code" placeholder="A" maxlength="1" />
            <button id="join-room" class="gold-btn">Join Room</button>
            <button id="create-room" class="gold-btn">Create Room</button>
          </div>
        </div>

        <div class="form-block">
          <label>Camera Check</label>
          <div class="row">
            <button id="test-camera" class="gold-btn">Test Camera</button>
          </div>
          <div class="row">
            <label for="input-mode-lobby">Control</label>
            <select id="input-mode-lobby">
              <option value="hand">Hand</option>
              <option value="eye">Eye (Blink Shoot)</option>
              <option value="mouse">Mouse</option>
            </select>
          </div>
          <div id="camera-test-stage" class="camera-test-stage">
            <video id="camera-test-video" class="camera-test-video" autoplay playsinline muted></video>
            <div id="camera-test-crosshair" class="camera-test-crosshair"></div>
          </div>
          <p class="status" id="camera-test-status">Camera not tested.</p>
        </div>

        <p class="status" id="lobby-status">Enter name, then create or join.</p>
      </section>

      <section id="screen-waiting" class="screen panel">
        <div class="panel-header">Lobby</div>
        <h2 class="title small">Waiting Room</h2>
        <p>Room Code: <strong id="waiting-room-code">----</strong></p>
        <p id="waiting-role" class="status">Share the code with player 2.</p>
        <div class="score-panel party-camera-panel">
          <h3>Party + Cameras</h3>
          <div class="party-columns">
            <article id="party-self-card" class="party-camera-card self">
              <div class="party-meta">
                <span id="party-self-name" class="player-name">You</span>
                <span id="party-self-score" class="player-score">0</span>
              </div>
              <video id="local-video-waiting" class="local-video" autoplay playsinline muted></video>
              <p id="local-status-waiting" class="status">Camera not connected yet.</p>
            </article>
            <article id="party-opp-card" class="party-camera-card">
              <div class="party-meta">
                <span id="party-opp-name" class="player-name">Waiting...</span>
                <span id="party-opp-score" class="player-score">0</span>
              </div>
              <video id="remote-video-waiting" class="remote-video" autoplay playsinline></video>
              <p id="remote-status-waiting" class="status">Waiting for opponent camera...</p>
            </article>
          </div>
        </div>
        <div class="score-panel">
          <h3>Game Settings</h3>
          <label for="match-duration-select">Match Duration</label>
          <select id="match-duration-select">
            <option value="30">30s</option>
            <option value="60" selected>60s</option>
            <option value="90">90s</option>
            <option value="120">120s</option>
          </select>
          <label for="waiting-input-mode">Input Mode</label>
          <select id="waiting-input-mode">
            <option value="hand">Hand</option>
            <option value="eye">Eye (Blink Shoot)</option>
            <option value="mouse">Mouse</option>
          </select>
        </div>
        <div class="row waiting-actions">
          <button id="start-match" class="gold-btn wide" disabled>Start Match</button>
        </div>
        <p class="status" id="waiting-status">Waiting for players...</p>
      </section>

      <section id="screen-playing" class="screen panel">
        <div class="playing-layout">
          <aside class="match-side left">
            <div class="score-panel side-card">
              <h3>My Feed</h3>
              <video id="local-video-playing" class="local-video" autoplay playsinline muted></video>
              <p id="local-status-playing" class="status">Camera not connected yet.</p>
            </div>
            <div id="stats-self-card" class="score-panel side-card">
              <h3>My Stats</h3>
              <div class="stat-row"><span>Name</span><strong id="stats-self-name">You</strong></div>
              <div class="stat-row"><span>Score</span><strong id="stats-self-score">0</strong></div>
            </div>
          </aside>

          <div class="match-center">
            <div class="panel-header">In Match</div>
            <h2 class="title small">Target Hunt</h2>
            <div id="stage" class="stage">
              <video id="webcam" class="webcam" autoplay playsinline muted></video>
              <div id="overlay-root" class="overlay-root"></div>
              <div class="stage-frame"></div>
              <div id="start-countdown" class="start-countdown" aria-live="polite"></div>
            </div>
            <div class="hud">
              <div class="badge">Room: <strong id="hud-room-code">----</strong></div>
              <div class="badge">Time: <strong id="hud-timer">60.0s</strong></div>
              <div class="badge">Tracking: <strong id="tracking-status">Initializing</strong></div>
              <div class="badge">Input: <strong id="hud-input-mode">Hand</strong></div>
            </div>
          </div>

          <aside class="match-side right">
            <div class="score-panel side-card">
              <h3>Opponent Feed</h3>
              <video id="remote-video-playing" class="remote-video" autoplay playsinline></video>
              <p id="remote-status-playing" class="status">Waiting for opponent camera...</p>
            </div>
            <div id="stats-opp-card" class="score-panel side-card pending">
              <h3>Opponent Stats</h3>
              <div class="stat-row"><span>Name</span><strong id="stats-opp-name">Waiting...</strong></div>
              <div class="stat-row"><span>Score</span><strong id="stats-opp-score">0</strong></div>
            </div>
          </aside>
        </div>
      </section>

      <section id="screen-results" class="screen panel">
        <div class="panel-header">Results</div>
        <h2 class="title small">Match Results</h2>
        <p id="results-title" class="results-title"></p>
        <p id="results-reason" class="status"></p>
        <div class="score-panel">
          <h3>Final Scores</h3>
          <ul class="players" id="results-players"></ul>
        </div>
      </section>
    </div>
  `;

  const screens: Record<ScreenId, HTMLElement> = {
    lobby: root.querySelector("#screen-lobby") as HTMLElement,
    waiting: root.querySelector("#screen-waiting") as HTMLElement,
    playing: root.querySelector("#screen-playing") as HTMLElement,
    results: root.querySelector("#screen-results") as HTMLElement
  };

  const playerNameInput = root.querySelector("#player-name") as HTMLInputElement;
  const createRoomButton = root.querySelector("#create-room") as HTMLButtonElement;
  const joinRoomInput = root.querySelector("#join-room-code") as HTMLInputElement;
  const joinRoomButton = root.querySelector("#join-room") as HTMLButtonElement;
  const startMatchButton = root.querySelector("#start-match") as HTMLButtonElement;
  const testCameraButton = root.querySelector("#test-camera") as HTMLButtonElement;
  const cameraTestStatus = root.querySelector("#camera-test-status") as HTMLParagraphElement;
  const cameraTestStage = root.querySelector("#camera-test-stage") as HTMLDivElement;
  const cameraTestCrosshair = root.querySelector("#camera-test-crosshair") as HTMLDivElement;
  const lobbyStatus = root.querySelector("#lobby-status") as HTMLParagraphElement;

  const waitingRoomCode = root.querySelector("#waiting-room-code") as HTMLElement;
  const waitingStatus = root.querySelector("#waiting-status") as HTMLElement;
  const waitingRole = root.querySelector("#waiting-role") as HTMLElement;
  const partySelfName = root.querySelector("#party-self-name") as HTMLElement;
  const partySelfScore = root.querySelector("#party-self-score") as HTMLElement;
  const partyOppName = root.querySelector("#party-opp-name") as HTMLElement;
  const partyOppScore = root.querySelector("#party-opp-score") as HTMLElement;
  const partyOppCard = root.querySelector("#party-opp-card") as HTMLElement;
  const localStatusWaiting = root.querySelector("#local-status-waiting") as HTMLElement;
  const localVideoWaiting = root.querySelector("#local-video-waiting") as HTMLVideoElement;
  const remoteStatusWaiting = root.querySelector("#remote-status-waiting") as HTMLElement;
  const remoteVideoWaiting = root.querySelector("#remote-video-waiting") as HTMLVideoElement;
  const matchDurationSelect = root.querySelector("#match-duration-select") as HTMLSelectElement;
  const waitingInputMode = root.querySelector("#waiting-input-mode") as HTMLSelectElement;
  const localStatusPlaying = root.querySelector("#local-status-playing") as HTMLElement;
  const localVideoPlaying = root.querySelector("#local-video-playing") as HTMLVideoElement;

  const hudRoomCode = root.querySelector("#hud-room-code") as HTMLElement;
  const hudTimer = root.querySelector("#hud-timer") as HTMLElement;
  const startCountdown = root.querySelector("#start-countdown") as HTMLElement;
  const trackingStatus = root.querySelector("#tracking-status") as HTMLElement;
  const hudInputMode = root.querySelector("#hud-input-mode") as HTMLElement;
  const inputModeLobby = root.querySelector("#input-mode-lobby") as HTMLSelectElement;
  const remoteStatusPlaying = root.querySelector("#remote-status-playing") as HTMLElement;
  const remoteVideoPlaying = root.querySelector("#remote-video-playing") as HTMLVideoElement;
  const statsSelfCard = root.querySelector("#stats-self-card") as HTMLElement;
  const statsOppCard = root.querySelector("#stats-opp-card") as HTMLElement;
  const statsSelfName = root.querySelector("#stats-self-name") as HTMLElement;
  const statsSelfScore = root.querySelector("#stats-self-score") as HTMLElement;
  const statsOppName = root.querySelector("#stats-opp-name") as HTMLElement;
  const statsOppScore = root.querySelector("#stats-opp-score") as HTMLElement;

  const resultsTitle = root.querySelector("#results-title") as HTMLElement;
  const resultsReason = root.querySelector("#results-reason") as HTMLElement;
  const resultsPlayers = root.querySelector("#results-players") as HTMLUListElement;

  const videoElement = root.querySelector("#webcam") as HTMLVideoElement;
  const cameraTestVideo = root.querySelector("#camera-test-video") as HTMLVideoElement;
  const overlayElement = root.querySelector("#overlay-root") as HTMLDivElement;
  const stageElement = root.querySelector("#stage") as HTMLDivElement;

  const setActiveScreen = (screen: ScreenId) => {
    for (const [id, element] of Object.entries(screens)) {
      element.classList.toggle("active", id === screen);
    }
  };

  const parseInputMode = (value: string): InputMode =>
    value === "mouse" ? "mouse" : value === "eye" ? "eye" : "hand";

  return {
    onCreateRoom(handler) {
      createRoomButton.addEventListener("click", () => {
        handler(playerNameInput.value.trim());
      });
    },
    onJoinRoom(handler) {
      joinRoomButton.addEventListener("click", () => {
        handler(joinRoomInput.value.trim().toUpperCase(), playerNameInput.value.trim());
      });
    },
    onStartMatch(handler) {
      startMatchButton.addEventListener("click", () => {
        handler();
      });
    },
    onTestCamera(handler) {
      testCameraButton.addEventListener("click", () => {
        handler();
      });
    },
    onInputModeChange(handler) {
      inputModeLobby.addEventListener("change", () => {
        handler(parseInputMode(inputModeLobby.value));
      });
      waitingInputMode.addEventListener("change", () => {
        handler(parseInputMode(waitingInputMode.value));
      });
    },
    onMatchDurationChange(handler) {
      matchDurationSelect.addEventListener("change", () => {
        const parsed = Number(matchDurationSelect.value);
        handler(Number.isFinite(parsed) ? parsed : 60);
      });
    },
    setStatus(message) {
      lobbyStatus.textContent = message;
      waitingStatus.textContent = message;
    },
    setCameraTestStatus(message) {
      cameraTestStatus.textContent = message;
    },
    setCameraTestPreviewVisible(visible) {
      cameraTestStage.classList.toggle("active", visible);
    },
    setCameraTestBusy(isBusy) {
      testCameraButton.disabled = isBusy;
      testCameraButton.textContent = isBusy ? "Testing..." : "Test Camera";
    },
    setCameraTestAim(x, y) {
      cameraTestCrosshair.style.left = `${(x * 100).toFixed(2)}%`;
      cameraTestCrosshair.style.top = `${(y * 100).toFixed(2)}%`;
    },
    setCameraTestAimVisible(visible) {
      cameraTestCrosshair.classList.toggle("active", visible);
    },
    setLocalCameraStatus(message) {
      localStatusWaiting.textContent = message;
      localStatusPlaying.textContent = message;
    },
    setLocalCameraVisible(visible) {
      localVideoWaiting.classList.toggle("active", visible);
      localVideoPlaying.classList.toggle("active", visible);
    },
    setRemoteCameraStatus(message) {
      remoteStatusWaiting.textContent = message;
      remoteStatusPlaying.textContent = message;
    },
    setRemoteCameraVisible(visible) {
      remoteVideoWaiting.classList.toggle("active", visible);
      remoteVideoPlaying.classList.toggle("active", visible);
    },
    setMatchDurationSeconds(seconds) {
      matchDurationSelect.value = String(seconds);
    },
    setMatchDurationEditable(editable) {
      matchDurationSelect.disabled = !editable;
    },
    setRoomCode(roomCode) {
      waitingRoomCode.textContent = roomCode;
      hudRoomCode.textContent = roomCode;
    },
    setWaitingPlayers(players, selfId) {
      const selfPlayer = players.find((player) => player.id === selfId);
      const opponent = players.find((player) => player.id !== selfId);

      partySelfName.textContent = selfPlayer ? `${selfPlayer.name}${selfId ? " (You)" : ""}` : "You";
      partySelfScore.textContent = String(selfPlayer?.score ?? 0);

      if (opponent) {
        partyOppName.textContent = opponent.name;
        partyOppScore.textContent = String(opponent.score);
        partyOppCard.classList.remove("pending");
      } else {
        partyOppName.textContent = "Waiting...";
        partyOppScore.textContent = "0";
        partyOppCard.classList.add("pending");
      }
    },
    setPlayingPlayers(players, selfId) {
      const selfPlayer = players.find((player) => player.id === selfId);
      const opponent = players.find((player) => player.id !== selfId);

      statsSelfName.textContent = selfPlayer ? `${selfPlayer.name}${selfId ? " (You)" : ""}` : "You";
      statsSelfScore.textContent = String(selfPlayer?.score ?? 0);

      if (opponent) {
        statsOppName.textContent = opponent.name;
        statsOppScore.textContent = String(opponent.score);
        statsOppCard.classList.remove("pending");
      } else {
        statsOppName.textContent = "Waiting...";
        statsOppScore.textContent = "0";
        statsOppCard.classList.add("pending");
      }

      const selfScore = selfPlayer?.score ?? 0;
      const oppScore = opponent?.score ?? 0;
      statsSelfCard.classList.toggle("leading", selfScore > oppScore && Boolean(opponent));
      statsOppCard.classList.toggle("leading", oppScore > selfScore && Boolean(opponent));
    },
    setTimer(timeRemainingMs) {
      hudTimer.textContent = formatTimer(timeRemainingMs);
    },
    setStartCountdown(secondsRemaining) {
      if (!secondsRemaining || secondsRemaining <= 0) {
        startCountdown.classList.remove("active");
        startCountdown.textContent = "";
        return;
      }

      startCountdown.textContent = String(secondsRemaining);
      startCountdown.classList.add("active");
    },
    setTrackingStatus(message) {
      trackingStatus.textContent = message;
    },
    setInputMode(mode) {
      inputModeLobby.value = mode;
      waitingInputMode.value = mode;
      hudInputMode.textContent = mode === "eye" ? "Eye (Blink)" : mode === "mouse" ? "Mouse" : "Hand";
    },
    setWaitingControls({ isHost, canStart, started, playerCount }) {
      startMatchButton.disabled = !canStart;
      if (started) {
        startMatchButton.textContent = "Match Starting...";
      } else if (isHost) {
        startMatchButton.textContent = playerCount >= 2 ? "Start Match" : "Need 2 Players";
      } else {
        startMatchButton.textContent = "Host Starts Match";
      }

      if (isHost) {
        waitingRole.textContent = playerCount >= 2 ? "You are the host. Start when ready." : "You are the host. Waiting for player 2.";
      } else {
        waitingRole.textContent = "Waiting for host to start the match.";
      }
      matchDurationSelect.disabled = !(isHost && !started);
      waitingInputMode.disabled = !(isHost && !started);
    },
    showLobby() {
      setActiveScreen("lobby");
    },
    showWaiting() {
      setActiveScreen("waiting");
    },
    showPlaying() {
      setActiveScreen("playing");
    },
    showResults(payload, selfId) {
      setActiveScreen("results");

      const winner = payload.winnerId ? payload.finalPlayers.find((player) => player.id === payload.winnerId) : null;
      if (payload.tie) {
        resultsTitle.textContent = "Tie game";
        resultsTitle.classList.remove("danger");
      } else if (winner) {
        const isSelf = winner.id === selfId;
        resultsTitle.textContent = isSelf ? "Victory" : `${winner.name} Wins`;
        resultsTitle.classList.toggle("danger", !isSelf);
      } else {
        resultsTitle.textContent = "Match ended";
      }

      resultsReason.textContent = payload.reason === "forfeit" ? "Reason: forfeit" : "Reason: timeout";
      renderPlayers(resultsPlayers, payload.finalPlayers, selfId);
    },
    getVideoElement() {
      return videoElement;
    },
    getCameraTestVideoElement() {
      return cameraTestVideo;
    },
    getLocalWaitingVideoElement() {
      return localVideoWaiting;
    },
    getLocalPlayingVideoElement() {
      return localVideoPlaying;
    },
    getRemoteWaitingVideoElement() {
      return remoteVideoWaiting;
    },
    getRemotePlayingVideoElement() {
      return remoteVideoPlaying;
    },
    getOverlayElement() {
      return overlayElement;
    },
    getStageElement() {
      return stageElement;
    }
  };
}
