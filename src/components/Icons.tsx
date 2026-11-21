// Iconos SVG propios (sin dependencias). Heredan el color del texto.

type P = { size?: number };
const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
});

export const PlayIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
);
export const PauseIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
export const PrevIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="5" y="5" width="2.5" height="14" rx="1" /><path d="M19 6v12a1 1 0 0 1-1.55.83L9 13.2a1.4 1.4 0 0 1 0-2.4l8.45-5.63A1 1 0 0 1 19 6z" /></svg>
);
export const NextIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="16.5" y="5" width="2.5" height="14" rx="1" /><path d="M5 6v12a1 1 0 0 0 1.55.83L15 13.2a1.4 1.4 0 0 0 0-2.4L6.55 5.17A1 1 0 0 0 5 6z" /></svg>
);
export const VolumeIcon = ({ size, muted }: P & { muted?: boolean }) => (
  <svg {...base(size)}>
    <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a1 1 0 0 0 1.7-.77V5.67a1 1 0 0 0-1.7-.77L8 8.5H5a1 1 0 0 0-1 1z" />
    {muted ? (
      <path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    ) : (
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    )}
  </svg>
);
export const FullscreenIcon = ({ size, exit }: P & { exit?: boolean }) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    {exit ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </svg>
);
export const ListIcon = ({ size }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </svg>
);
export const TracksIcon = ({ size }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 12.5h4M13 12.5h4M7 15.5h7" strokeLinecap="round" />
  </svg>
);
export const OpenIcon = ({ size }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
);
export const CloseIcon = ({ size }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const GearIcon = ({ size }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const LogoIcon = ({ size = 72 }: P) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
    <ellipse cx="50" cy="50" rx="34" ry="21" fill="#ff8800" />
    <ellipse cx="50" cy="50" rx="28" ry="16" fill="#0b0b0d" />
    <circle cx="50" cy="50" r="15.5" fill="#ff8800" />
    <path d="M46 42v16l12.5-8z" fill="#0b0b0d" />
  </svg>
);
