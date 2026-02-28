const MENU_MUSIC_PATH = "/audio/sfx/menu_music.mp3";
const ATTACK_SOUND_PATH = "/audio/sfx/attack_sound.mp3";

export class LocalGameAudio {
  private readonly menuMusic = new Audio(MENU_MUSIC_PATH);

  private readonly attackTemplate = new Audio(ATTACK_SOUND_PATH);

  private unlocked = false;

  private menuMusicEnabled = false;

  private disposed = false;

  private unlockListenersActive = true;

  private pendingMenuSyncSeconds: number | null = null;

  private playbackRateResetTimerId = 0;

  private readonly unlockAudio = () => {
    this.unlocked = true;
    void this.syncMenuMusic();
  };

  private readonly onTouchStart = () => {
    this.unlockAudio();
  };

  private readonly onMenuMusicMetadataLoaded = () => {
    this.applyPendingMenuSync();
  };

  constructor() {
    this.menuMusic.loop = true;
    this.menuMusic.preload = "auto";
    this.menuMusic.volume = 0.35;
    this.menuMusic.addEventListener("loadedmetadata", this.onMenuMusicMetadataLoaded);

    this.attackTemplate.preload = "auto";
    this.attackTemplate.volume = 0.6;

    window.addEventListener("pointerdown", this.unlockAudio, { passive: true });
    window.addEventListener("mousedown", this.unlockAudio);
    window.addEventListener("touchstart", this.onTouchStart, { passive: true });
    window.addEventListener("keydown", this.unlockAudio);
  }

  setMenuMusicEnabled(enabled: boolean): void {
    this.menuMusicEnabled = enabled;
    void this.syncMenuMusic();
  }

  syncMenuMusicClock(startedAtMs: number, serverNowMs: number, estimatedOneWayLatencyMs = 0): void {
    if (this.disposed) {
      return;
    }

    const elapsedSeconds = Math.max(0, (serverNowMs + estimatedOneWayLatencyMs - startedAtMs) / 1000);
    this.seekMenuMusicTo(elapsedSeconds);
    void this.syncMenuMusic();
  }

  playAttack(): void {
    if (this.disposed || !this.unlocked) {
      return;
    }

    const attackAudio = this.attackTemplate.cloneNode(true) as HTMLAudioElement;
    attackAudio.volume = this.attackTemplate.volume;
    void attackAudio.play().catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.removeUnlockListeners();
    this.menuMusic.removeEventListener("loadedmetadata", this.onMenuMusicMetadataLoaded);
    if (this.playbackRateResetTimerId) {
      window.clearTimeout(this.playbackRateResetTimerId);
      this.playbackRateResetTimerId = 0;
    }

    this.menuMusic.pause();
    this.menuMusic.src = "";
    this.attackTemplate.src = "";
  }

  private removeUnlockListeners(): void {
    if (!this.unlockListenersActive) {
      return;
    }
    this.unlockListenersActive = false;
    window.removeEventListener("pointerdown", this.unlockAudio);
    window.removeEventListener("mousedown", this.unlockAudio);
    window.removeEventListener("touchstart", this.onTouchStart);
    window.removeEventListener("keydown", this.unlockAudio);
  }

  private async syncMenuMusic(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (!this.menuMusicEnabled) {
      this.menuMusic.pause();
      this.menuMusic.currentTime = 0;
      return;
    }

    if (!this.unlocked || !this.menuMusic.paused) {
      if (this.unlocked && !this.menuMusic.paused) {
        this.removeUnlockListeners();
      }
      return;
    }

    try {
      await this.menuMusic.play();
      this.applyPendingMenuSync();
      this.removeUnlockListeners();
    } catch {
      // Keep listeners active so future gestures can retry playback.
    }
  }

  private seekMenuMusicTo(elapsedSeconds: number): void {
    const duration = this.menuMusic.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      this.pendingMenuSyncSeconds = elapsedSeconds;
      return;
    }

    const targetSeconds = elapsedSeconds % duration;
    const delta = targetSeconds - this.menuMusic.currentTime;
    const distance = Math.abs(delta);

    if (distance < 0.02) {
      return;
    }

    // Small offsets are corrected with short rate nudges to avoid audible seek clicks.
    if (!this.menuMusic.paused && distance < 0.18) {
      this.menuMusic.playbackRate = delta > 0 ? 1.03 : 0.97;
      if (this.playbackRateResetTimerId) {
        window.clearTimeout(this.playbackRateResetTimerId);
      }
      this.playbackRateResetTimerId = window.setTimeout(() => {
        this.menuMusic.playbackRate = 1;
        this.playbackRateResetTimerId = 0;
      }, 220);
      return;
    }

    try {
      this.menuMusic.currentTime = targetSeconds;
      this.pendingMenuSyncSeconds = null;
    } catch {
      this.pendingMenuSyncSeconds = elapsedSeconds;
    }
  }

  private applyPendingMenuSync(): void {
    if (this.pendingMenuSyncSeconds === null) {
      return;
    }
    const pendingSeconds = this.pendingMenuSyncSeconds;
    this.pendingMenuSyncSeconds = null;
    this.seekMenuMusicTo(pendingSeconds);
  }
}
