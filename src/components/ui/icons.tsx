/**
 * PokeFinds ikonbibliotek — ett enhetligt set med stroke-ikoner (24×24, stroke 1.75).
 * Använd alltid dessa istället för emojis i UI:t.
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const IconDashboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconBell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const IconPackage = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m7.5 4.3 9 5.2" />
    <path d="M21 8.2v7.6a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4a2 2 0 0 1-1-1.7V8.2a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4a2 2 0 0 1 1 1.7Z" />
    <path d="M3.3 7.3 12 12l8.7-4.7" />
    <path d="M12 22V12" />
  </svg>
);

export const IconCamera = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const IconTrendingUp = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m22 7-7.9 7.9-4-4L2 19" />
    <path d="M16 7h6v6" />
  </svg>
);

export const IconTrendingDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m22 17-7.9-7.9-4 4L2 5" />
    <path d="M16 17h6v-6" />
  </svg>
);

export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 14v3" />
    <path d="M11 9v8" />
    <path d="M15 12v5" />
    <path d="M19 6v11" />
  </svg>
);

export const IconMessage = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.3-.7L3 21l1.8-5.7A8.4 8.4 0 1 1 21 11.5Z" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
  </svg>
);

export const IconHeart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 14c1.5-1.5 2.6-3.2 2.6-5.2A4.8 4.8 0 0 0 16.8 4c-1.9 0-3.6 1-4.8 2.6A6 6 0 0 0 7.2 4a4.8 4.8 0 0 0-4.8 4.8c0 2 1.1 3.7 2.6 5.2L12 21l7-7Z" />
  </svg>
);

export const IconBookmark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 21 12 16.5 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" />
  </svg>
);

export const IconFlag = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 22V4a1 1 0 0 1 .4-.8C5.5 2.4 7 2 8.5 2c3 0 4.5 2 7 2 1.3 0 2.5-.3 3.7-.8a.5.5 0 0 1 .8.4v10.6a1 1 0 0 1-.6.9c-1.2.6-2.5.9-3.9.9-2.5 0-4-2-7-2-1.4 0-2.6.3-3.5.8" />
  </svg>
);

export const IconShare = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
);

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconStore = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m3 9 1.5-5h15L21 9" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    <path d="M5 11.8V21h14v-9.2" />
    <path d="M9 21v-5h6v5" />
  </svg>
);

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconUser = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

export const IconLogout = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const IconWrench = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14.7 6.3a4.5 4.5 0 0 0 6 6L17 16l-4.8 4.8a2.1 2.1 0 0 1-3-3L14 13 7.7 6.7a4.5 4.5 0 0 0-6-6l3.6 3.6-1.4 3.4-3.4 1.4" transform="rotate(90 12 12)" />
  </svg>
);

export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M19 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
  </svg>
);

export const IconAlertTriangle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const IconEye = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 8 5-5 5 5" />
    <path d="M12 3v13" />
  </svg>
);

export const IconCards = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="11" height="16" rx="1.8" transform="rotate(-8 8.5 13)" />
    <path d="M14 4.5 18.6 3a1.8 1.8 0 0 1 2.3 1.2l3 11" transform="scale(0.85) translate(2 2)" />
  </svg>
);

export const IconMail = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="m3 7.5 9 6 9-6" />
  </svg>
);

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const IconLock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2.5" />
  </svg>
);

export const IconGem = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 3.5h11L21 9l-9 11.5L3 9l3.5-5.5Z" />
    <path d="M3 9h18" />
    <path d="m8.5 9 3.5 11.5L15.5 9" />
    <path d="m6.5 3.5 2 5.5 3.5-5.5 3.5 5.5 2-5.5" />
  </svg>
);

export const IconReceipt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-2.5-1.7L14 21l-2-1.4L10 21l-2.5-1.7L5 21Z" />
    <path d="M9 7.5h6M9 11h6M9 14.5h4" />
  </svg>
);

export const IconTrophy = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 4h8v6a4 4 0 0 1-8 0V4Z" />
    <path d="M8 5H4.5v1.5A3.5 3.5 0 0 0 8 10M16 5h3.5v1.5A3.5 3.5 0 0 1 16 10" />
    <path d="M12 14v3.5" />
    <path d="M8.5 21h7M10 17.5h4l1 3.5h-6l1-3.5Z" />
  </svg>
);

export const IconGift = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="8" width="17" height="4" rx="1" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    <path d="M12 8v13" />
    <path d="M12 8c-2.5 0-4.5-1-4.5-2.7C7.5 4 8.5 3 9.8 3 11.5 3 12 5.5 12 8ZM12 8c2.5 0 4.5-1 4.5-2.7C16.5 4 15.5 3 14.2 3 12.5 3 12 5.5 12 8Z" />
  </svg>
);
