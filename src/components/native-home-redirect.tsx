"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

/**
 * I native-appen (Capacitor) öppnar vi Utforska, inte marknadsförings-startsidan —
 * app-användare ska inte mötas av en "gå med"-pitch. På webben gör den ingenting.
 */
export function NativeHomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (Capacitor.isNativePlatform()) router.replace("/produkter");
  }, [router]);
  return null;
}
