/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import type { GradingIssuer } from "@/lib/graded-listing";
import { ISSUER_LABELS } from "@/lib/graded-listing";
import { gradeNumber, gradeWord } from "@/lib/graded-slab";
import { cn } from "@/lib/utils";

/**
 * GRADERAT KORT I SLAB (ägarbeslut 2026-10-15): akrylfodralet runt kortet och
 * bolagets etikett ovanför — i bolagets EGEN färgsättning (ägaren valde
 * etikett-repliker framför en neutral egen etikett, medvetet om att det är
 * bolagens varumärkesutstyrsel).
 *
 * ⛔ REFERENSBRUK, SAMMA REGEL SOM LOGGORNA: etiketten står bara vid användarens
 *    eget graderade kort. Ber ett bolag oss ta bort sin etikett — byt till
 *    `GenericLabel` för det bolaget samma dag.
 * ⛔ Inget påhittat: inget certnummer, inga delbetyg, inget kortnamn vi inte
 *    vet. Streckkoden är dekor (ränder), aldrig en läsbar kod.
 *
 * Skalar med sin BREDD (container-enheter, `cqw`): samma komponent ritar en
 * 100 px ruta i rutnätet och förhandsvisningen i paywall-arket. Fyll en
 * förälder med fast höjd — slabben tar höjden och räknar ut bredden (62:100,
 * ett riktigt fodrals proportion).
 */

const LOGOS: Partial<Record<GradingIssuer, string>> = {
  PSA: "/grading-logos/psa.svg",
  BGS: "/grading-logos/bgs.png",
  CGC: "/grading-logos/cgc.png",
  SGC: "/grading-logos/sgc.png",
  ACE: "/grading-logos/ace.png",
  TAG: "/grading-logos/tag.png",
  RAUKCARD: "/grading-logos/raukcard.png",
};

/** Text i container-enheter — etiketten skalar med slabbens bredd. */
const fs = (cqw: number): CSSProperties => ({ fontSize: `${cqw}cqw` });

/**
 * Bolagets märke TONAT till en färg: filerna är vita (ritade för mörk yta), så de
 * används som MASK med bakgrundsfärg — då går de att lägga även på en vit etikett.
 */
function TintedLogo({ issuer, color, height }: { issuer: GradingIssuer; color: string; height: number }) {
  const src = LOGOS[issuer];
  if (!src) {
    return (
      <span className="font-black leading-none" style={{ ...fs(height * 0.9), color }}>
        {ISSUER_LABELS[issuer]}
      </span>
    );
  }
  // Märkets bredd följer filens proportion — kvadratiska emblem (BGS, RaukCard) är smala.
  const aspect = issuer === "BGS" || issuer === "RAUKCARD" ? 1.05 : issuer === "PSA" ? 2.67 : 2.4;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{
        height: `${height}cqw`,
        width: `${height * aspect}cqw`,
        backgroundColor: color,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "left center",
        maskPosition: "left center",
      }}
    />
  );
}

/** Dekorativa streckkodsränder (aldrig en läsbar kod). */
function Barcode({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block", className)}
      style={{
        backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 1px, transparent 1px 2px, ${color} 2px 4px, transparent 4px 5px, ${color} 5px 6px, transparent 6px 8px)`,
      }}
    />
  );
}

interface LabelProps {
  issuer: GradingIssuer;
  gradeTenths: number;
}

const GOLD = "linear-gradient(135deg, #f6e3a1 0%, #d4a93c 45%, #b8862a 60%, #f1d98a 100%)";
const SILVER = "linear-gradient(135deg, #f4f5f7 0%, #c9ccd2 45%, #a9adb5 60%, #eceef1 100%)";

function PsaLabel({ gradeTenths }: LabelProps) {
  const word = gradeWord("PSA", gradeTenths);
  return (
    <div className="flex h-full overflow-hidden bg-white" style={{ border: "1.8cqw solid #d71920", borderRadius: "1.5cqw" }}>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.6cqw] pl-[3.5cqw]">
        {word && (
          <span className="truncate font-black leading-none tracking-tight text-black" style={fs(10)}>
            {word}
          </span>
        )}
        <span className="flex items-center gap-[2cqw]">
          <Barcode color="#111" className="h-[3.6cqw] w-[30cqw]" />
          <TintedLogo issuer="PSA" color="#1b3f94" height={3.6} />
        </span>
      </div>
      <span className="flex items-center pr-[3.5cqw] font-semibold leading-none text-black" style={fs(17)}>
        {gradeNumber(gradeTenths)}
      </span>
    </div>
  );
}

function CgcLabel({ gradeTenths }: LabelProps) {
  const word = gradeWord("CGC", gradeTenths);
  const top = gradeTenths === 100;
  return (
    <div className="flex h-full overflow-hidden bg-[#0d0d0f]" style={{ borderRadius: "1.5cqw", border: "0.8cqw solid #2b2b30" }}>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.8cqw] pl-[3.5cqw]">
        <TintedLogo issuer="CGC" color="#ffffff" height={4} />
        {word && (
          <span className="truncate font-black leading-none tracking-tight text-white" style={fs(9.5)}>
            {word}
          </span>
        )}
      </div>
      <span
        className="m-[1.6cqw] flex items-center justify-center px-[3cqw] font-black leading-none text-black"
        style={{ ...fs(15), background: top ? GOLD : SILVER, borderRadius: "1cqw", minWidth: "19cqw" }}
      >
        {gradeNumber(gradeTenths)}
      </span>
    </div>
  );
}

function BgsLabel({ gradeTenths }: LabelProps) {
  const word = gradeWord("BGS", gradeTenths);
  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: gradeTenths >= 95 ? GOLD : SILVER, borderRadius: "1.5cqw", border: "0.8cqw solid rgba(0,0,0,.25)" }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.4cqw] pl-[3.5cqw]">
        <span className="font-black leading-none tracking-[0.12em] text-black/70" style={fs(4.2)}>
          BECKETT
        </span>
        {word && (
          <span className="truncate font-black leading-none tracking-tight text-black" style={fs(9.5)}>
            {word}
          </span>
        )}
      </div>
      <span className="flex items-center pr-[3.5cqw] font-black leading-none text-black" style={fs(17)}>
        {gradeNumber(gradeTenths)}
      </span>
    </div>
  );
}

function SgcLabel({ gradeTenths }: LabelProps) {
  const word = gradeWord("SGC", gradeTenths);
  return (
    <div className="flex h-full overflow-hidden bg-black" style={{ borderRadius: "1.5cqw", border: "0.8cqw solid #3a3a3f" }}>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.8cqw] pl-[3.5cqw]">
        <TintedLogo issuer="SGC" color={gradeTenths === 100 ? "#e2bf5f" : "#ffffff"} height={4.2} />
        {word && (
          <span className="truncate font-bold leading-none tracking-tight text-white" style={fs(9)}>
            {word}
          </span>
        )}
      </div>
      <span
        className="flex items-center pr-[3.5cqw] font-bold leading-none"
        style={{ ...fs(17), color: gradeTenths === 100 ? "#e2bf5f" : "#ffffff" }}
      >
        {gradeNumber(gradeTenths)}
      </span>
    </div>
  );
}

function TagLabel({ gradeTenths }: LabelProps) {
  const word = gradeWord("TAG", gradeTenths);
  return (
    <div className="relative flex h-full overflow-hidden bg-white" style={{ borderRadius: "1.5cqw", border: "0.8cqw solid #111" }}>
      {/* Svart fält med betygsordet, snett avskuret mot det guldfärgade betygsfältet. */}
      <div
        className="flex min-w-0 flex-1 flex-col justify-center gap-[1.6cqw] bg-black pl-[3.5cqw] pr-[8cqw]"
        style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 6cqw) 100%, 0 100%)" }}
      >
        <TintedLogo issuer="TAG" color="#ffffff" height={3.6} />
        {word && (
          <span className="truncate font-black leading-none tracking-tight text-white" style={fs(9.5)}>
            {word}
          </span>
        )}
      </div>
      <span
        className="-ml-[6cqw] flex items-center justify-center pl-[7cqw] pr-[3.5cqw] font-black leading-none text-black"
        style={{ ...fs(16), background: GOLD }}
      >
        {gradeNumber(gradeTenths)}
      </span>
    </div>
  );
}

/** Bolag utan egen replika (ACE, RaukCard, okända): märket + ord + betyg på mörk etikett. */
function GenericLabel({ issuer, gradeTenths }: LabelProps) {
  const word = issuer === "OTHER" ? "GRADED" : gradeWord(issuer, gradeTenths);
  return (
    <div className="flex h-full overflow-hidden bg-[#121417]" style={{ borderRadius: "1.5cqw", border: "0.8cqw solid #2c3036" }}>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.8cqw] pl-[3.5cqw]">
        {issuer !== "OTHER" && <TintedLogo issuer={issuer} color="#ffffff" height={4.4} />}
        {word && (
          <span className="truncate font-black leading-none tracking-tight text-white" style={fs(9)}>
            {word}
          </span>
        )}
      </div>
      <span
        className="m-[1.6cqw] flex items-center justify-center px-[3cqw] font-black leading-none text-black"
        style={{ ...fs(15), background: gradeTenths === 100 ? GOLD : SILVER, borderRadius: "1cqw", minWidth: "19cqw" }}
      >
        {gradeNumber(gradeTenths)}
      </span>
    </div>
  );
}

const LABELS: Partial<Record<GradingIssuer, (p: LabelProps) => ReactNode>> = {
  PSA: PsaLabel,
  CGC: CgcLabel,
  BGS: BgsLabel,
  SGC: SgcLabel,
  TAG: TagLabel,
};

export function SlabLabel(props: LabelProps) {
  const Label = LABELS[props.issuer] ?? GenericLabel;
  return <Label {...props} />;
}

export function GradedSlab({
  imageUrl,
  issuer,
  gradeTenths,
  alt = "",
  className,
}: {
  imageUrl: string | null;
  issuer: GradingIssuer;
  gradeTenths: number;
  alt?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("relative aspect-[62/100] h-full max-w-full", className)}
      style={{ containerType: "inline-size" }}
      role="img"
      aria-label={`${ISSUER_LABELS[issuer]} ${gradeNumber(gradeTenths)}${alt ? ` · ${alt}` : ""}`}
    >
      {/* Akrylfodralet: ljus kant, svag reflex uppifrån, inre skugga runt kortfönstret. */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          padding: "4.5cqw",
          gap: "4cqw",
          borderRadius: "5cqw",
          background:
            "linear-gradient(160deg, rgba(235,240,245,.55) 0%, rgba(200,208,216,.28) 30%, rgba(170,178,188,.2) 62%, rgba(225,230,236,.42) 100%)",
          boxShadow:
            "inset 0 0 0 0.9cqw rgba(255,255,255,.6), inset 0 0 0 2cqw rgba(255,255,255,.1), 0 2cqw 6cqw rgba(0,0,0,.55)",
        }}
      >
        <div className="shrink-0" style={{ height: "22cqw" }}>
          <SlabLabel issuer={issuer} gradeTenths={gradeTenths} />
        </div>
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          style={{
            padding: "3cqw",
            borderRadius: "2cqw",
            background: "rgba(0,0,0,.35)",
            boxShadow: "inset 0 0 0 0.6cqw rgba(255,255,255,.18)",
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-contain"
            />
          ) : null}
          {/* Reflex i akrylen — diagonal glans över kortet. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(115deg, transparent 35%, rgba(255,255,255,.14) 45%, transparent 55%)" }}
          />
        </div>
      </div>
    </div>
  );
}
