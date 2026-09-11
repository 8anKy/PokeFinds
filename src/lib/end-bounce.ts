/** Delad signal mellan slutstudsen i läsytan och den fixerade bottennavigeringen. */
export const END_BOUNCE_EVENT = "foilio:end-bounce";

export type EndBounceDetail = {
  offset: number;
  settling: boolean;
};
