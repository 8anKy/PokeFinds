import { registerPlugin } from '@capacitor/core';
// Ingen webb-implementation med flit: på webben kastar Capacitor UNIMPLEMENTED,
// och src/lib/on-device-number.ts anropar aldrig pluginet där.
const FoilioTextRecognition = registerPlugin('FoilioTextRecognition');
export { FoilioTextRecognition };
