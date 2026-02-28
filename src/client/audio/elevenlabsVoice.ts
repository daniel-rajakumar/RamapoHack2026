const TTS_ENDPOINT = "/api/voice/tts";
const MAX_TEXT_LENGTH = 120;

function normalizeVoiceText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function waitForPlayback(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    let timeoutId = 0;

    const cleanup = () => {
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("error", cleanup);
      window.clearTimeout(timeoutId);
      resolve();
    };

    audio.addEventListener("ended", cleanup);
    audio.addEventListener("error", cleanup);
    timeoutId = window.setTimeout(cleanup, 10_000);
  });
}

export class ElevenLabsVoiceAnnouncer {
  private enabled = true;

  private playbackChain: Promise<void> = Promise.resolve();

  private readonly playbackAudio = new Audio();

  private readonly cachedAudioByText = new Map<string, string>();

  private readonly pendingAudioByText = new Map<string, Promise<string | null>>();

  prefetch(texts: string[]): void {
    for (const rawText of texts) {
      const text = normalizeVoiceText(rawText);
      if (!text) {
        continue;
      }
      void this.getAudioUrl(text);
    }
  }

  speak(rawText: string): void {
    const text = normalizeVoiceText(rawText);
    if (!text || !this.enabled) {
      return;
    }

    this.playbackChain = this.playbackChain
      .then(async () => {
        const audioUrl = await this.getAudioUrl(text);
        if (!audioUrl) {
          return;
        }

        this.playbackAudio.pause();
        this.playbackAudio.src = audioUrl;
        this.playbackAudio.currentTime = 0;

        try {
          await this.playbackAudio.play();
        } catch {
          return;
        }

        await waitForPlayback(this.playbackAudio);
      })
      .catch(() => undefined);
  }

  dispose(): void {
    this.playbackAudio.pause();
    this.playbackAudio.src = "";

    for (const audioUrl of this.cachedAudioByText.values()) {
      URL.revokeObjectURL(audioUrl);
    }
    this.cachedAudioByText.clear();
    this.pendingAudioByText.clear();
    this.enabled = false;
  }

  private async getAudioUrl(text: string): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    const cached = this.cachedAudioByText.get(text);
    if (cached) {
      return cached;
    }

    const pending = this.pendingAudioByText.get(text);
    if (pending) {
      return pending;
    }

    const request = this.fetchAudioUrl(text).finally(() => {
      this.pendingAudioByText.delete(text);
    });
    this.pendingAudioByText.set(text, request);
    return request;
  }

  private async fetchAudioUrl(text: string): Promise<string | null> {
    try {
      const response = await fetch(TTS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        if (response.status === 503) {
          this.enabled = false;
        }
        return null;
      }

      const audioBlob = await response.blob();
      if (audioBlob.size === 0) {
        return null;
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      this.cachedAudioByText.set(text, audioUrl);
      return audioUrl;
    } catch {
      return null;
    }
  }
}
