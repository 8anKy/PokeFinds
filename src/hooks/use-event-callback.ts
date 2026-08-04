"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * STABIL IDENTITET, FÄRSKT INNEHÅLL — för callbacks som en effekt REGISTRERAR
 * lyssnare utifrån.
 *
 * ⛔ VARFÖR DEN FINNS (bugg i fält 2026-08-04): skannerns bottenark registrerar
 * sina touch-lyssnare i en effekt med `[onClose]` i beroendelistan, och
 * anroparen skickade `onClose={() => setDetailsId(null)}` — en ny funktion vid
 * VARJE rendering. Live-pollen bakom arket sätter state var 600:e ms, så
 * effekten revs och registrerades om ~1,6 gånger i sekunden. Mitt i ett svep
 * betyder det att den NYA uppsättningen lyssnare aldrig sett `touchstart`:
 * `dragging` är false i dess closure, arket slutar följa fingret och fryser på
 * det senast skrivna värdet. Ett SNABBT svep hann klart inom ett 600 ms-fönster;
 * ett långsamt gjorde det aldrig — alltså exakt symtomet "fungerar bara när jag
 * sveper fort", som såg ut som ett gestproblem i två felsökningsomgångar.
 *
 * Samma lärdom som kamerans livscykel redan bär (project_pokefinds, CLAUDE.md):
 * **en callback som en effekt med cleanup beror på måste ha stabil identitet,
 * annars är dess cleanup en tyst rivning vid varje rendering.**
 *
 * Den returnerade funktionen byter ALDRIG identitet, men anropar alltid den
 * senaste versionen — så effekten kan ha `[]` i praktiken utan att någonsin läsa
 * gammal state.
 */
export function useEventCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useRef(fn);
  // Uppdateras efter varje rendering. Callbacken anropas ur event-hanterare,
  // alltså långt efter paint — ingen risk att läsa en gammal version.
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
