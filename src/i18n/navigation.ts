import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-medvetna ersättare för next/link + next/navigation. Använd DESSA i stället
// så att engelska (/en) behålls vid navigering; på svenska beter de sig som vanligt.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
