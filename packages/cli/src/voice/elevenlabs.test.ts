import { afterEach, describe, expect, it, vi } from "vitest";
import { elevenlabs } from "./elevenlabs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const request = { provider: "elevenlabs", voice: "a".repeat(20), text: "Hello" };

describe("ElevenLabs request lifecycle", () => {
  it("bounds a stalled synthesis and never retries the billable request", async () => {
    const timeout = new AbortController();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(elevenlabs.synthesize(request, "test-key")).rejects.toThrow("provider timed out");
    timeout.abort(new Error("provider timed out"));
    await result;
    expect(deadline).toHaveBeenCalledWith(120_000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("propagates cancellation while the response body is still loading", async () => {
    const controller = new AbortController();
    let bodyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () => new Promise((_, reject) => {
        bodyStarted();
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      }),
    })));
    const result = expect(elevenlabs.synthesize(request, "test-key", controller.signal)).rejects.toThrow("cancelled");
    await started;
    controller.abort(new Error("cancelled"));
    await result;
  });

  it("keeps cached voice lists scoped to credentials", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({
      voices: [{ voice_id: (init.headers as Record<string, string>)["xi-api-key"], name: "Voice" }],
    })));
    vi.stubGlobal("fetch", fetch);
    expect((await elevenlabs.voices("account-one"))[0].id).toBe("account-one");
    expect((await elevenlabs.voices("account-two"))[0].id).toBe("account-two");
    expect((await elevenlabs.voices("account-one"))[0].id).toBe("account-one");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
