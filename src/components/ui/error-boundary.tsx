"use client";
/**
 * FELGRÄNS FÖR EN DEL AV SIDAN. Ett kastat fel i en React-komponent utan gräns
 * ovanför sig tar HELA sidan med sig — Next ritar "Application error: a
 * client-side exception has occurred" på svart (sett i appen 2026-09-15 när
 * ett betygsklick träffade en cachad payload utan `history`). En prisgraf eller
 * en karusell som går sönder ska bli en tom yta, inte en död sida.
 *
 * Renderar `fallback` (default: ingenting) och loggar felet en gång. Ingen
 * "försök igen"-knapp här — delarna hämtar om sig själva vid nästa navigering.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Namn i loggen så felet går att hitta ("graded-carousel"). */
  name: string;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[error-boundary:${this.props.name}]`, error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
