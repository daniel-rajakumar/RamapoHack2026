import type { InputMode } from "../config";
import type { MatchEnd, PlayerView } from "../types";

type ScreenId = "lobby" | "waiting" | "playing" | "results";

export interface UIController {
  onCreateRoom(handler: (name: string) => void): void;
  onJoinRoom(handler: (roomCode: string, name: string) => void): void;
  onStartMatch(handler: () => void): void;
  onInputModeChange(handler: (mode: InputMode) => void): void;
  setStatus(message: string): void;
  setRoomCode(roomCode: string): void;
  setWaitingPlayers(players: PlayerView[], selfId?: string): void;
  setPlayingPlayers(players: PlayerView[], selfId?: string): void;
  setTimer(timeRemainingMs: number): void;
  setTrackingStatus(message: string): void;
  setInputMode(mode: InputMode): void;
  setWaitingControls(params: { isHost: boolean; canStart: boolean; started: boolean; playerCount: number }): void;
  showLobby(): void;
  showWaiting(): void;
  showPlaying(): void;
  showResults(payload: MatchEnd, selfId?: string): void;
  getVideoElement(): HTMLVideoElement;
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
          <div class="row">
            <button id="create-room" class="gold-btn">Create Room</button>
          </div>
        </div>

        <div class="form-block">
          <label for="join-room-code">Room Code</label>
          <div class="row">
            <input id="join-room-code" placeholder="ABC123" maxlength="6" />
            <button id="join-room" class="gold-btn">Join Room</button>
          </div>
        </div>

        <p class="status" id="lobby-status">Enter name, then create or join.</p>
      </section>

      <section id="screen-waiting" class="screen panel">
        <div class="panel-header">Lobby</div>
        <h2 class="title small">Waiting Room</h2>
        <p>Room Code: <strong id="waiting-room-code">----</strong></p>
        <p id="waiting-role" class="status">Share the code with player 2.</p>
        <div class="score-panel">
          <h3>Party</h3>
          <ul class="players" id="waiting-players"></ul>
        </div>
        <div class="row waiting-actions">
          <button id="start-match" class="gold-btn wide" disabled>Start Match</button>
        </div>
        <p class="status" id="waiting-status">Waiting for players...</p>
      </section>

      <section id="screen-playing" class="screen panel">
        <div class="panel-header">In Match</div>
        <h2 class="title small">Target Hunt</h2>
        <div id="stage" class="stage">
          <video id="webcam" class="webcam" autoplay playsinline muted></video>
          <div id="overlay-root" class="overlay-root"></div>
          <div class="stage-frame"></div>
        </div>
        <div class="hud">
          <div class="badge">Room: <strong id="hud-room-code">----</strong></div>
          <div class="badge">Time: <strong id="hud-timer">60.0s</strong></div>
          <div class="badge">Tracking: <strong id="tracking-status">Initializing</strong></div>
          <label class="badge" for="input-mode">
            Input
            <select id="input-mode">
              <option value="hand">Hand</option>
              <option value="mouse">Mouse</option>
            </select>
          </label>
        </div>
        <div class="score-panel">
          <h3>Scoreboard</h3>
          <ul class="players" id="hud-players"></ul>
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
  const lobbyStatus = root.querySelector("#lobby-status") as HTMLParagraphElement;

  const waitingRoomCode = root.querySelector("#waiting-room-code") as HTMLElement;
  const waitingStatus = root.querySelector("#waiting-status") as HTMLElement;
  const waitingRole = root.querySelector("#waiting-role") as HTMLElement;
  const waitingPlayers = root.querySelector("#waiting-players") as HTMLUListElement;

  const hudRoomCode = root.querySelector("#hud-room-code") as HTMLElement;
  const hudTimer = root.querySelector("#hud-timer") as HTMLElement;
  const trackingStatus = root.querySelector("#tracking-status") as HTMLElement;
  const hudPlayers = root.querySelector("#hud-players") as HTMLUListElement;
  const inputMode = root.querySelector("#input-mode") as HTMLSelectElement;

  const resultsTitle = root.querySelector("#results-title") as HTMLElement;
  const resultsReason = root.querySelector("#results-reason") as HTMLElement;
  const resultsPlayers = root.querySelector("#results-players") as HTMLUListElement;

  const videoElement = root.querySelector("#webcam") as HTMLVideoElement;
  const overlayElement = root.querySelector("#overlay-root") as HTMLDivElement;
  const stageElement = root.querySelector("#stage") as HTMLDivElement;

  const setActiveScreen = (screen: ScreenId) => {
    for (const [id, element] of Object.entries(screens)) {
      element.classList.toggle("active", id === screen);
    }
  };

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
    onInputModeChange(handler) {
      inputMode.addEventListener("change", () => {
        const mode = inputMode.value === "mouse" ? "mouse" : "hand";
        handler(mode);
      });
    },
    setStatus(message) {
      lobbyStatus.textContent = message;
      waitingStatus.textContent = message;
    },
    setRoomCode(roomCode) {
      waitingRoomCode.textContent = roomCode;
      hudRoomCode.textContent = roomCode;
    },
    setWaitingPlayers(players, selfId) {
      renderPlayers(waitingPlayers, players, selfId);
    },
    setPlayingPlayers(players, selfId) {
      renderPlayers(hudPlayers, players, selfId);
    },
    setTimer(timeRemainingMs) {
      hudTimer.textContent = formatTimer(timeRemainingMs);
    },
    setTrackingStatus(message) {
      trackingStatus.textContent = message;
    },
    setInputMode(mode) {
      inputMode.value = mode;
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
    getOverlayElement() {
      return overlayElement;
    },
    getStageElement() {
      return stageElement;
    }
  };
}
