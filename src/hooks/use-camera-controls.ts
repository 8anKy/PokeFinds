"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyTorch,
  applyZoomValue,
  derivePresetFromSettings,
  listVideoDevices,
  pickUltraWideDevice,
  readCapabilities,
  readSettings,
  readTorchSupport,
  readZoomRange,
  resolveZoomPresets,
  type VideoDeviceLike,
  type ZoomContext,
  type ZoomPreset,
  type ZoomPresetOption,
} from "@/lib/camera-controls";

/**
 * React-skalet runt `src/lib/camera-controls.ts`: livscykel, state och
 * upprensning. All BESLUTSLOGIK ligger i lib-modulen och är enhetstestad —
 * här finns bara det som kräver en levande webbläsare.
 *
 * ⛔ HOOKEN ÄGER INTE STRÖMMEN. Den varken startar eller stoppar kameran; den
 * får ett `MediaStream` av anroparen och släpper det när anroparen säger till.
 * Skanner-sidan äger `getUserMedia`/`stopCamera`, och ett förval som kräver ett
 * annat objektiv rapporteras som `needs-stream-restart` — aldrig som en tyst
 * omstart bakom anroparens rygg.
 */

export type ZoomApplyResult =
  /** Klart — kameran står på förvalet. */
  | { ok: true; preset: ZoomPreset }
  /**
   * Förvalet kräver en ANNAN kamera. Anroparen ska:
   *   1. stoppa nuvarande ström,
   *   2. köra getUserMedia med `withDeviceId(dinaVideoConstraints, deviceId)`,
   *   3. anropa `attach(nyaStrömmen)`.
   * Hooken minns förvalet och sätter zoomen på det nya spåret om det behövs.
   */
  | { ok: false; reason: "needs-stream-restart"; preset: ZoomPreset; deviceId: string }
  /** Ingen levande videospår att ställa in. */
  | { ok: false; reason: "no-track"; preset: ZoomPreset }
  /** Förvalet finns inte på den här enheten (ska normalt aldrig renderas). */
  | { ok: false; reason: "unavailable"; preset: ZoomPreset }
  /** `applyConstraints` avvisade — enheten sa nej. */
  | { ok: false; reason: "failed"; preset: ZoomPreset };

export interface CameraControls {
  /** Koppla in (eller koppla loss med `null`) strömmen. Stoppar aldrig spår. */
  attach: (stream: MediaStream | null) => void;
  /** Läs om kapabiliteter/inställningar (t.ex. efter `loadedmetadata`). */
  refresh: () => void;

  /** Kan enheten tända lampan ALLS? false ⇒ rendera ingen knapp. */
  torchSupported: boolean;
  /** Lampans faktiska läge enligt spåret. */
  torchOn: boolean;
  setTorch: (on: boolean) => Promise<boolean>;
  toggleTorch: () => Promise<boolean>;

  /** Bara de förval som FAKTISKT går att nå, i ordningen 0,5× / 1× / 2×. */
  zoomPresets: ZoomPresetOption[];
  /** Förvalet kameran står på nu. */
  zoom: ZoomPreset;
  applyZoom: (preset: ZoomPreset) => Promise<ZoomApplyResult>;
}

export function useCameraControls(externalStream?: MediaStream | null): CameraControls {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<VideoDeviceLike[]>([]);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomPresets, setZoomPresets] = useState<ZoomPresetOption[]>([]);
  const [zoom, setZoom] = useState<ZoomPreset>(1);

  const mounted = useRef(true);
  /** Kameran vi startade i — dit 1×/2× hör hemma efter en tur till ultravidvinkeln. */
  const defaultDeviceId = useRef<string | null>(null);
  /** Förval som väntar på ett nytt spår (satt när vi svarat needs-stream-restart). */
  const pendingPreset = useRef<ZoomPreset | null>(null);
  /** Räknare så att en långsam enumerering inte skriver över en nyare ström. */
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Anroparen får välja stil: skicka in strömmen som argument (om den ligger i
  // state) ELLER anropa `attach` (om den ligger i en ref, som i skanner-sidan).
  // `undefined` = "jag sköter det med attach"; `null` = "ingen ström".
  useEffect(() => {
    if (externalStream !== undefined) setStream(externalStream);
  }, [externalStream]);

  const track = useMemo(() => stream?.getVideoTracks()[0] ?? null, [stream]);

  const ultraWideDeviceId = useMemo(() => pickUltraWideDevice(devices), [devices]);

  /** Läser om ALLT ur spåret. Idempotent — kallas vid attach, unmute och refresh. */
  const sync = useCallback(() => {
    if (!mounted.current) return;
    const caps = readCapabilities(track);
    const settings = readSettings(track);
    const zoomRange = readZoomRange(caps);
    const currentDeviceId = settings?.deviceId ?? null;

    // Första levande spåret definierar "huvudkameran". Är vi (mot förmodan)
    // startade i ultravidvinkeln lämnas den tom — då döljs 1×/2× hellre än att
    // vi lovar en väg tillbaka vi inte har id:t till.
    if (
      currentDeviceId &&
      defaultDeviceId.current === null &&
      currentDeviceId !== ultraWideDeviceId
    ) {
      defaultDeviceId.current = currentDeviceId;
    }

    const ctx: ZoomContext = {
      zoomRange,
      currentDeviceId,
      defaultDeviceId: defaultDeviceId.current,
      ultraWideDeviceId,
    };

    const options = resolveZoomPresets(ctx);

    setTorchSupported(readTorchSupport(caps));
    // Ficklampan ÖVERLEVER INGENTING: ett nytt spår börjar alltid släckt, och
    // efter ett objektivbyte kan kapabiliteten vara borta helt. Läs den ur
    // spåret i stället för att minnas vår egen senaste begäran.
    setTorchOn(settings?.torch === true);
    setZoomPresets(options);
    setZoom(derivePresetFromSettings(settings, ctx));

    // Väntande förval efter en ström-omstart (t.ex. 2× på väg tillbaka från
    // ultravidvinkeln). Ren zoom appliceras här; ett förval som kräver ÄNNU en
    // enhet lämnas till användaren — vi kedjar aldrig omstarter automatiskt.
    const pending = pendingPreset.current;
    if (pending !== null) {
      pendingPreset.current = null;
      const option = options.find((o) => o.preset === pending);
      if (option && !option.requiresStreamRestart && typeof option.trackZoom === "number") {
        void applyZoomValue(track, option.trackZoom).then((ok) => {
          if (ok && mounted.current) setZoom(pending);
        });
      } else if (option) {
        setZoom(pending);
      }
    }
  }, [track, ultraWideDeviceId]);

  // Enumerering: etiketterna är TOMMA innan kameratillstånd getts, så den här
  // körs när ett spår kopplats in (= tillstånd finns) och vid `devicechange`.
  useEffect(() => {
    if (!track) return;
    const gen = ++generation.current;
    let cancelled = false;
    const load = () => {
      void listVideoDevices().then((list) => {
        if (cancelled || !mounted.current || gen !== generation.current) return;
        setDevices(list);
      });
    };
    load();
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    md?.addEventListener?.("devicechange", load);
    return () => {
      cancelled = true;
      md?.removeEventListener?.("devicechange", load);
    };
  }, [track]);

  // Spårets livscykel. `unmute` = spåret börjar leverera bild — på flera
  // Android-skal är `getCapabilities()` TOM före det, så en enda läsning vid
  // attach hade dolt både ficklampan och zoomen på just de enheter som har dem.
  useEffect(() => {
    sync();
    if (!track) return;
    const onEnded = () => sync();
    track.addEventListener("ended", onEnded);
    track.addEventListener("unmute", onEnded);
    track.addEventListener("mute", onEnded);
    return () => {
      track.removeEventListener("ended", onEnded);
      track.removeEventListener("unmute", onEnded);
      track.removeEventListener("mute", onEnded);
    };
  }, [track, sync]);

  const attach = useCallback((next: MediaStream | null) => {
    setStream(next);
  }, []);

  const setTorch = useCallback(
    async (on: boolean): Promise<boolean> => {
      if (!track) return false;
      const actual = await applyTorch(track, on);
      if (mounted.current) setTorchOn(actual);
      return actual;
    },
    [track]
  );

  const toggleTorch = useCallback(() => setTorch(!torchOn), [setTorch, torchOn]);

  const applyZoom = useCallback(
    async (preset: ZoomPreset): Promise<ZoomApplyResult> => {
      const option = zoomPresets.find((o) => o.preset === preset);
      if (!option) return { ok: false, reason: "unavailable", preset };
      if (option.requiresStreamRestart) {
        if (!option.deviceId) return { ok: false, reason: "unavailable", preset };
        // Minns förvalet: efter omstarten kan det behövas en zoom OVANPÅ bytet
        // (2× på huvudkameran). Anroparen gör bytet — vi rör inte strömmen.
        pendingPreset.current = preset;
        return { ok: false, reason: "needs-stream-restart", preset, deviceId: option.deviceId };
      }
      if (!track) return { ok: false, reason: "no-track", preset };
      if (typeof option.trackZoom !== "number") {
        // 1× på en enhet helt utan zoom-kapabilitet: redan där per definition.
        if (mounted.current) setZoom(preset);
        return { ok: true, preset };
      }
      const ok = await applyZoomValue(track, option.trackZoom);
      if (!ok) return { ok: false, reason: "failed", preset };
      // Läs tillbaka verkligheten — plattformen kan ha klampat begäran.
      if (mounted.current) {
        const settings = readSettings(track);
        const caps = readCapabilities(track);
        setZoom(
          derivePresetFromSettings(settings, {
            zoomRange: readZoomRange(caps),
            currentDeviceId: settings?.deviceId ?? null,
            defaultDeviceId: defaultDeviceId.current,
            ultraWideDeviceId,
          })
        );
      }
      return { ok: true, preset };
    },
    [track, ultraWideDeviceId, zoomPresets]
  );

  /**
   * ⛔ MEMOISERAT MED FLIT. Ett bart objektliteral hade gett en NY identitet vid
   * varje rendering, och anropare lägger rimligen `camera` i sina
   * beroende-listor. Skanner-sidan gjorde det: `stopCamera` fick nya
   * beroenden varje rendering, avmonterings-effekten kördes om, dess cleanup
   * rev strömmen, `startCamera` startade om och anropade `attach()` → ny state →
   * ny rendering. Kameran gick aldrig live (2026-08-02).
   *
   * Identiteten byts nu bara när något FAKTISKT ändrats. Notera att den ändå
   * byts när `zoomPresets` fylls i efter första spåret — anropare som styr
   * kamerans livscykel ska därför ändå gå via en ref, inte via det här objektet.
   */
  return useMemo(
    () => ({
      attach,
      refresh: sync,
      torchSupported,
      torchOn,
      setTorch,
      toggleTorch,
      zoomPresets,
      zoom,
      applyZoom,
    }),
    [attach, sync, torchSupported, torchOn, setTorch, toggleTorch, zoomPresets, zoom, applyZoom]
  );
}
