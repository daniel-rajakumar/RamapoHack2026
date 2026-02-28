import type { InputMode } from "../config";
import type { MatchEnd, PlayerView } from "../types";

type ScreenId = "lobby" | "waiting" | "playing" | "results";

export interface UIController {
  onCreateRoom(handler: (name: string) => void): void;
  onJoinRoom(handler: (roomCode: string, name: string) => void): void;
  onInputModeChange(handler: (mode: InputMode) => void): void;
  setStatus(message: string): void;
  setRoomCode(roomCode: string): void;
  setWaitingPlayers(players: PlayerView[], selfId?: string): void;
  setPlayingPlayers(players: PlayerView[], selfId?: string): void;
  setTimer(timeRemainingMs: number): void;
  setTrackingStatus(message: string): void;
  setInputMode(mode: InputMode): void;
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
    li.textContent = `${player.name}${player.id === selfId ? " (You)" : ""}: ${player.score}`;
    if (player.id === selfId) {
      li.classList.add("self");
    }
    container.appendChild(li);
  }
}

function formatTimer(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

export function createUI(root: HTMLElement): UIController {
  root.innerHTML = `
    <div class="app-shell">
      <section id="screen-lobby" class="screen active">
        <h1>Gesture Shooter MVP</h1>
        <p>2 players • server authoritative • 60s match</p>
        <div class="row">
          <label for="player-name">Name</label>
          <input id="player-name" placeholder="Enter your name" maxlength="20" />
          <button id="create-room">Create Room</button>
        </div>
        <div class="row">
          <label for="join-room-code">Room Code</label>
          <input id="join-room-code" placeholder="ABC123" maxlength="6" />
          <button id="join-room">Join Room</button>
        </div>
        <p class="status" id="lobby-status">Waiting for input.</p>
      </section>

      <section id="screen-waiting" class="screen">
        <h2>Waiting Room</h2>
        <p>Room Code: <strong id="waiting-room-code">----</strong></p>
        <p class="status" id="waiting-status">Share code with player 2.</p>
        <ul class="players" id="waiting-players"></ul>
      </section>

      <section id="screen-playing" class="screen">
        <h2>Playing</h2>
        <div id="stage" class="stage">
          <video id="webcam" class="webcam" autoplay playsinline muted></video>
          <div id="overlay-root" class="overlay-root"></div>
        </div>
        <div class="hud">
          <div class="badge">Room: <strong id="hud-room-code">----</strong></div>
          <div class="badge">Time: <strong id="hud-timer">60.0</strong>s</div>
          <div class="badge">Tracking: <strong id="tracking-status">Initializing</strong></div>
          <label class="badge" for="input-mode">
            Input
            <select id="input-mode">
              <option value="hand">Hand</option>
              <option value="mouse">Mouse</option>
            </select>
          </label>
        </div>
        <h3>Scores</h3>
        <ul class="players" id="hud-players"></ul>
      </section>

      <section id="screen-results" class="screen">
        <h2>Match Results</h2>
        <p id="results-title" class="results-title"></p>
        <p id="results-reason"></p>
        <ul class="players" id="results-players"></ul>
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
  const lobbyStatus = root.querySelector("#lobby-status") as HTMLParagraphElement;

  const waitingRoomCode = root.querySelector("#waiting-room-code") as HTMLElement;
  const waitingStatus = root.querySelector("#waiting-status") as HTMLElement;
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
        resultsTitle.textContent = isSelf ? "You win" : `${winner.name} wins`;
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
