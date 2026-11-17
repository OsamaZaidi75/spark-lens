/**
 * Line icons, one set, one stroke (1.5). No emoji anywhere in the UI.
 * Sizes: 14–18px in context, 28px for the dropzone.
 */

interface IconProps {
  size?: number;
  color?: string;
}

function base(size: number, color: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

/** The brand mark: a lens ring. Amber stroke on the dark tile. */
export function LensMark({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size, "#f5a524")} strokeWidth={2}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
    </svg>
  );
}

export function UploadIcon({
  size = 28,
  color = "currentColor",
}: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function FileIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function ArrowRightIcon({
  size = 14,
  color = "currentColor",
}: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 16, color = "currentColor" }: IconProps) {
  return (
    <svg {...base(size, color)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * The sample log's real stage chain (0→1→2→3→4→5), drawn small.
 * Stage 2 — the skewed one — carries the amber lens ring: the signature
 * detail, a thin ring around the thing being inspected.
 */
export function HeroMotif() {
  const nodes = [0, 1, 2, 3, 4, 5];
  const x0 = 28;
  const gap = 48;
  const y = 20;
  return (
    <svg
      width="296"
      height="40"
      viewBox="0 0 296 40"
      role="img"
      aria-label="Six stages in a chain, the third one ringed"
    >
      <line
        x1={x0}
        y1={y}
        x2={x0 + 5 * gap}
        y2={y}
        stroke="rgba(163,169,184,0.35)"
        strokeWidth="1"
      />
      {nodes.map((n) => {
        const x = x0 + n * gap;
        const isSkewed = n === 2;
        return (
          <g key={n}>
            {isSkewed && (
              <circle
                cx={x}
                cy={y}
                r="15"
                fill="none"
                stroke="#f5a524"
                strokeWidth="1.5"
              />
            )}
            <rect
              x={x - 6}
              y={y - 6}
              width="12"
              height="12"
              rx="3.5"
              fill={isSkewed ? "#f5a524" : "#101d33"}
              stroke={
                isSkewed
                  ? "#f5a524"
                  : "rgba(238,240,245,0.25)"
              }
              strokeWidth="1"
            />
          </g>
        );
      })}
    </svg>
  );
}
