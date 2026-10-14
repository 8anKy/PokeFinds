import { describe, it, expect } from "vitest";
import { getItemLiveness } from "@/jobs/tradera-ended";

// 2026-10-14: N · 30th Celebration Classic Collection visade en avslutad annons som "I lager".
const item = (fields: string) => `<GetItemResponse><GetItemResult><Id>754378108</Id>${fields}</GetItemResult></GetItemResponse>`;

describe("getItemLiveness", () => {
  it("avslutad annons", () => {
    expect(getItemLiveness(item("<Ended>true</Ended><EndDate>2026-10-13T20:00:00</EndDate>"))).toEqual({ ended: true, buyNowOre: null });
  });
  it("slutdatum passerat räcker", () => {
    expect(getItemLiveness(item("<Ended>false</Ended><EndDate>2026-10-01T00:00:00</EndDate>"), Date.parse("2026-10-14")).ended).toBe(true);
  });
  it("levande annons bär sitt Köp nu-pris", () => {
    expect(getItemLiveness(item("<Ended>false</Ended><EndDate>2026-11-01T00:00:00</EndDate><BuyItNowPrice>100</BuyItNowPrice>"), Date.parse("2026-10-14"))).toEqual({ ended: false, buyNowOre: 10000 });
  });
  it("SOAP-fault = borttagen annons", () => {
    expect(getItemLiveness("<s:Envelope><s:Body><s:Fault><faultcode>s:Client</faultcode></s:Fault></s:Body></s:Envelope>").ended).toBe(true);
  });
});
