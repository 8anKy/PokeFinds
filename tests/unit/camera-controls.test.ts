import { describe, it, expect } from "vitest";
import {
  BULK_DETECTOR_MAX_CARDS,
  ZOOM_PRESET_MAX_CARDS,
  ZOOM_PRESETS,
  applyTorch,
  applyZoomValue,
  derivePresetFromSettings,
  pickUltraWideDevice,
  readCapabilities,
  readTorchSupport,
  readZoomRange,
  recommendedBulkCards,
  resolveZoomPresets,
  snapZoom,
  withDeviceId,
  zoomBaseUnit,
  zoomValueForPreset,
  type CameraCapabilities,
  type ZoomContext,
  type ZoomPreset,
} from "@/lib/camera-controls";

/**
 * Testar BESLUTEN, inte webbläsaren. Allt som kräver riktig kamerahårdvara
 * (att lampan verkligen tänds, att objektivet verkligen byts) är OTESTBART här
 * och måste verifieras på en fysisk telefon — se rapporten.
 */

const range = (min: number, max: number, step = 0) => ({ min, max, step });

describe("readTorchSupport", () => {
  it("accepterar både Chromes bara `true` och spec:ens boolean-lista", () => {
    expect(readTorchSupport({ torch: true })).toBe(true);
    expect(readTorchSupport({ torch: [false, true] })).toBe(true);
  });

  it("säger nej när listan bara innehåller false (framkamera)", () => {
    // Den här skillnaden är hela poängen: `[false]` betyder uttryckligen
    // "kan inte", och ett Array-truthy-test hade tänt knappen på framkameran.
    expect(readTorchSupport({ torch: [false] })).toBe(false);
  });

  it("säger nej när fältet saknas helt (desktop, iOS Safari)", () => {
    expect(readTorchSupport({})).toBe(false);
    expect(readTorchSupport(null)).toBe(false);
    expect(readTorchSupport(undefined)).toBe(false);
  });
});

describe("readZoomRange", () => {
  it("läser ut min/max/step", () => {
    expect(readZoomRange({ zoom: { min: 1, max: 8, step: 0.1 } })).toEqual({
      min: 1,
      max: 8,
      step: 0.1,
    });
  });

  it("saknat step = kontinuerlig (0)", () => {
    expect(readZoomRange({ zoom: { min: 1, max: 4 } })).toEqual({ min: 1, max: 4, step: 0 });
  });

  it("avvisar saknad, tom eller degenererad kapabilitet", () => {
    expect(readZoomRange({})).toBeNull();
    expect(readZoomRange(null)).toBeNull();
    expect(readZoomRange({ zoom: {} })).toBeNull();
    expect(readZoomRange({ zoom: { min: 2, max: 2 } })).toBeNull();
  });

  it("avvisar otolkbara intervall (max < 1.5) i stället för att gissa skalan", () => {
    // {min:0,max:1} är varken faktor eller procent. Att tolka 1 som "1×" hade
    // gjort 2× till en no-op och 0,5× till något oförutsägbart.
    expect(readZoomRange({ zoom: { min: 0, max: 1 } })).toBeNull();
  });
});

describe("zoomBaseUnit", () => {
  it("faktorskala: 1 är neutralläget", () => {
    expect(zoomBaseUnit(range(1, 8))).toBe(1);
    expect(zoomBaseUnit(range(0.5, 8))).toBe(1);
  });

  it("procentskala kräver BÅDA signalerna (min>=50 och max>=40)", () => {
    expect(zoomBaseUnit(range(100, 800))).toBe(100);
    expect(zoomBaseUnit(range(50, 400))).toBe(100);
  });

  it("stor max i faktorskala läses inte som procent (Samsungs 100× digitala zoom)", () => {
    // min = 1 ⇒ faktorskala, oavsett hur stort max är.
    expect(zoomBaseUnit(range(1, 100))).toBe(1);
  });

  it("en kamera som redan börjar inzoomad har inget lägre 1×", () => {
    expect(zoomBaseUnit(range(2, 8))).toBe(2);
  });
});

describe("zoomValueForPreset", () => {
  it("2× på faktorskala", () => {
    expect(zoomValueForPreset(2, range(1, 8))).toBe(2);
  });

  it("2× på procentskala blir 200, inte 2", () => {
    // Ett hårdkodat `zoom: 2` hade här betytt "nästan helt utzoomat".
    expect(zoomValueForPreset(2, range(100, 800, 1))).toBe(200);
  });

  it("0,5× finns bara när enheten faktiskt når under bas (ihopsmält ultravidvinkel)", () => {
    expect(zoomValueForPreset(0.5, range(1, 8))).toBeNull();
    expect(zoomValueForPreset(0.5, range(0.5, 8))).toBe(0.5);
  });

  it("onåbart 2× klampas INTE in — det rapporteras som saknat", () => {
    // En 2×-knapp som i verkligheten ger 1,6× ljuger om vad användaren får.
    expect(zoomValueForPreset(2, range(1, 1.6))).toBeNull();
  });

  it("snappar till NÄRMASTE steg — även när det ligger strax under förvalet", () => {
    // Stegen är 1 / 1,3 / 1,6 / 1,9 / 2,2 → närmast 2 är 1,9. Kameran ger alltså
    // 1,9× när användaren tryckt 2×. Det är enhetens granularitet, inte en lögn:
    // tillgängligheten avgörs FÖRE snappningen (2 ryms i [1,8]), och att i
    // stället runda UPP till 2,2 hade gett mer zoom än användaren bad om.
    expect(zoomValueForPreset(2, range(1, 8, 0.3))).toBeCloseTo(1.9, 6);
  });

  it("null-intervall (ingen zoom-kapabilitet) ger null", () => {
    expect(zoomValueForPreset(2, null)).toBeNull();
  });
});

describe("snapZoom", () => {
  it("klampar in i intervallet", () => {
    expect(snapZoom(99, range(1, 8))).toBe(8);
    expect(snapZoom(-1, range(1, 8))).toBe(1);
  });

  it("snappar aldrig ut över max", () => {
    // Avrundning uppåt får inte producera ett värde applyConstraints avvisar.
    expect(snapZoom(7.95, range(1, 8, 0.3))).toBeLessThanOrEqual(8);
  });

  it("lämnar ingen flyttalssmuts", () => {
    expect(snapZoom(1.3, range(1, 8, 0.1))).toBe(1.3);
  });
});

describe("pickUltraWideDevice", () => {
  const dev = (deviceId: string, label: string) => ({ deviceId, kind: "videoinput", label });

  it("hittar iOS ultravidvinkel", () => {
    expect(
      pickUltraWideDevice([
        dev("a", "Back Camera"),
        dev("b", "Back Ultra Wide Camera"),
        dev("c", "Front Camera"),
      ])
    ).toBe("b");
  });

  it("⛔ 'Back Dual Wide Camera' är INTE ultravidvinkeln", () => {
    // Den är den sammansatta (virtuella) kameran. En bar "wide"-matchning hade
    // bytt till fel objektiv — värre än att sakna knappen.
    expect(
      pickUltraWideDevice([dev("a", "Back Dual Wide Camera"), dev("b", "Back Triple Camera")])
    ).toBeNull();
  });

  it("Android Chromes ogenomskinliga etiketter ger null, inte en gissning", () => {
    expect(
      pickUltraWideDevice([
        dev("a", "camera2 0, facing back"),
        dev("b", "camera2 2, facing back"),
      ])
    ).toBeNull();
  });

  it("accepterar '0.5x' i etiketten men aldrig en framkamera", () => {
    expect(pickUltraWideDevice([dev("a", "Kamera 0.5x bak")])).toBe("a");
    expect(pickUltraWideDevice([dev("a", "Front Ultra Wide Camera")])).toBeNull();
  });

  it("hoppar över icke-video och id-lösa enheter", () => {
    expect(
      pickUltraWideDevice([
        { deviceId: "m", kind: "audioinput", label: "Ultra Wide Mic" },
        { deviceId: "", kind: "videoinput", label: "Back Ultra Wide Camera" },
      ])
    ).toBeNull();
  });
});

describe("resolveZoomPresets", () => {
  const ctx = (over: Partial<ZoomContext> = {}): ZoomContext => ({
    zoomRange: null,
    currentDeviceId: "main",
    defaultDeviceId: "main",
    ultraWideDeviceId: null,
    ...over,
  });
  const presets = (c: ZoomContext) => resolveZoomPresets(c).map((o) => o.preset);

  it("utan zoom och utan ultravidvinkel finns BARA 1×", () => {
    const options = resolveZoomPresets(ctx());
    expect(options.map((o) => o.preset)).toEqual([1]);
    expect(options[0].kind).toBe("native");
    expect(options[0].requiresStreamRestart).toBe(false);
  });

  it("zoom-kapabilitet ger 2× på samma spår", () => {
    const options = resolveZoomPresets(ctx({ zoomRange: range(1, 8, 0.1) }));
    expect(options.map((o) => o.preset)).toEqual([1, 2]);
    const two = options.find((o) => o.preset === 2)!;
    expect(two.kind).toBe("zoom");
    expect(two.trackZoom).toBe(2);
    expect(two.requiresStreamRestart).toBe(false);
  });

  it("0,5× via ultravidvinkeln flaggas som ström-omstart med enhetens id", () => {
    const options = resolveZoomPresets(
      ctx({ zoomRange: range(1, 8, 0.1), ultraWideDeviceId: "uw" })
    );
    expect(options.map((o) => o.preset)).toEqual([0.5, 1, 2]);
    const half = options[0];
    expect(half.kind).toBe("device");
    expect(half.deviceId).toBe("uw");
    expect(half.requiresStreamRestart).toBe(true);
  });

  it("ihopsmält ultravidvinkel (min < bas) ger 0,5× UTAN omstart", () => {
    const half = resolveZoomPresets(ctx({ zoomRange: range(0.5, 8, 0.1) }))[0];
    expect(half.preset).toBe(0.5);
    expect(half.kind).toBe("zoom");
    expect(half.requiresStreamRestart).toBe(false);
    expect(half.trackZoom).toBe(0.5);
  });

  it("stående PÅ ultravidvinkeln: 0,5× är aktivt, 1×/2× kräver byte tillbaka", () => {
    const options = resolveZoomPresets(
      ctx({
        zoomRange: range(1, 4, 0.1),
        currentDeviceId: "uw",
        ultraWideDeviceId: "uw",
        defaultDeviceId: "main",
      })
    );
    expect(options.map((o) => o.preset)).toEqual([0.5, 1, 2]);
    expect(options[0].requiresStreamRestart).toBe(false);
    for (const o of options.slice(1)) {
      expect(o.kind).toBe("device");
      expect(o.deviceId).toBe("main");
      expect(o.requiresStreamRestart).toBe(true);
    }
  });

  it("på ultravidvinkeln UTAN känd huvudkamera döljs 1×/2× (ingen väg tillbaka)", () => {
    expect(
      presets(
        ctx({ currentDeviceId: "uw", ultraWideDeviceId: "uw", defaultDeviceId: null })
      )
    ).toEqual([0.5]);
  });

  it("för svag zoom ⇒ inget 2×", () => {
    expect(presets(ctx({ zoomRange: range(1, 1.6, 0.1) }))).toEqual([1]);
  });

  it("varje förval bär en kortrekommendation", () => {
    for (const o of resolveZoomPresets(ctx({ zoomRange: range(0.5, 8, 0.1) }))) {
      expect(o.maxCards).toBe(recommendedBulkCards(o.preset));
    }
  });
});

describe("derivePresetFromSettings", () => {
  const base: ZoomContext = {
    zoomRange: range(1, 8, 0.1),
    currentDeviceId: "main",
    defaultDeviceId: "main",
    ultraWideDeviceId: "uw",
  };

  it("ultravidvinkeln = 0,5× oavsett zoom-värde", () => {
    expect(derivePresetFromSettings({ zoom: 1 }, { ...base, currentDeviceId: "uw" })).toBe(0.5);
  });

  it("läser förvalet ur spårets faktiska zoom", () => {
    expect(derivePresetFromSettings({ zoom: 2 }, base)).toBe(2);
    expect(derivePresetFromSettings({ zoom: 1 }, base)).toBe(1);
  });

  it("procentskala tolkas mot sin egen bas", () => {
    expect(derivePresetFromSettings({ zoom: 200 }, { ...base, zoomRange: range(100, 800, 1) })).toBe(2);
  });

  it("ett snappat värde räknas ändå som sitt förval", () => {
    // Enheter med grova steg landar på 1,9× när vi bad om 2× — knappen ska lysa.
    expect(derivePresetFromSettings({ zoom: 1.9 }, base)).toBe(2);
  });

  it("ett äkta mellanläge lyser inte upp någon knapp", () => {
    // 1,4× (t.ex. OS-nyp) är inget förval — knappraden ska visa var kameran ÄR.
    expect(derivePresetFromSettings({ zoom: 1.4 }, base)).toBe(1);
  });

  it("utan zoom-information är svaret 1×", () => {
    expect(derivePresetFromSettings(null, base)).toBe(1);
    expect(derivePresetFromSettings({}, { ...base, zoomRange: null })).toBe(1);
  });
});

describe("kortrekommendation (OMÄTTA uppskattningar)", () => {
  it("aldrig över bulk-detektorns tak", () => {
    // Vakt mot att någon höjer tabellen förbi BULK_MAX_CARDS i skanna/page.tsx.
    for (const preset of ZOOM_PRESETS) {
      expect(recommendedBulkCards(preset)).toBeLessThanOrEqual(BULK_DETECTOR_MAX_CARDS);
      expect(recommendedBulkCards(preset)).toBeGreaterThanOrEqual(1);
    }
  });

  it("faller monotont med zoomen (synfältet krymper)", () => {
    expect(ZOOM_PRESET_MAX_CARDS[0.5]).toBeGreaterThan(ZOOM_PRESET_MAX_CARDS[1]);
    expect(ZOOM_PRESET_MAX_CARDS[1]).toBeGreaterThan(ZOOM_PRESET_MAX_CARDS[2]);
  });

  it("okänt förval degraderar till 1 i stället för undefined", () => {
    expect(recommendedBulkCards(3 as unknown as ZoomPreset)).toBe(1);
  });
});

describe("withDeviceId", () => {
  it("behåller anroparens upplösningskrav", () => {
    const out = withDeviceId({ width: { ideal: 3840 }, height: { ideal: 2160 } }, "uw");
    expect(out.width).toEqual({ ideal: 3840 });
    expect(out.height).toEqual({ ideal: 2160 });
    expect(out.deviceId).toEqual({ exact: "uw" });
  });

  it("tar bort facingMode (kan motsäga ett exakt deviceId)", () => {
    const source = { facingMode: { ideal: "environment" }, width: { ideal: 1920 } };
    const out = withDeviceId(source, "uw");
    expect(out.facingMode).toBeUndefined();
    // Anroparens objekt muteras inte.
    expect(source.facingMode).toEqual({ ideal: "environment" });
  });
});

describe("spår-operationer failar tyst, aldrig med en oavhanterad rejection", () => {
  const fakeTrack = (opts: {
    readyState?: string;
    caps?: CameraCapabilities;
    settings?: MediaTrackSettings;
    reject?: boolean;
  }) =>
    ({
      readyState: opts.readyState ?? "live",
      getCapabilities: () => opts.caps ?? {},
      getSettings: () => opts.settings ?? {},
      applyConstraints: async () => {
        // Så beter sig riktiga enheter vid ett villkor de inte stödjer — och en
        // oavhanterad rejection blir en KRASCH i Capacitor-WebViewen.
        if (opts.reject) throw new Error("OverconstrainedError");
      },
    }) as unknown as MediaStreamTrack;

  it("applyTorch returnerar false när enheten avvisar", async () => {
    await expect(applyTorch(fakeTrack({ reject: true }), true)).resolves.toBe(false);
  });

  it("applyTorch litar på spårets settings framför sin egen begäran", async () => {
    // Några Android-skal löser ut applyConstraints men tänder inget.
    await expect(applyTorch(fakeTrack({ settings: { torch: false } }), true)).resolves.toBe(false);
    await expect(applyTorch(fakeTrack({ settings: {} }), true)).resolves.toBe(true);
  });

  it("applyZoomValue och applyTorch klarar null-spår och avslutade spår", async () => {
    await expect(applyZoomValue(null, 2)).resolves.toBe(false);
    await expect(applyTorch(undefined, true)).resolves.toBe(false);
    await expect(applyZoomValue(fakeTrack({ readyState: "ended" }), 2)).resolves.toBe(false);
  });

  it("readCapabilities tål saknad getCapabilities (iOS Safari) och avslutade spår", () => {
    expect(readCapabilities({ readyState: "live" } as unknown as MediaStreamTrack)).toBeNull();
    expect(readCapabilities(fakeTrack({ readyState: "ended" }))).toBeNull();
    expect(readCapabilities(fakeTrack({ caps: { torch: true } }))).toEqual({ torch: true });
  });
});
