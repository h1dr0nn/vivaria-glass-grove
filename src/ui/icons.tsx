/**
 * Inline SVG icons - path data from Lucide (lucide.dev), ISC license.
 * Inlined to keep the bundle dependency-free; stroke follows currentColor.
 */

interface IconProps {
  size?: number;
}

function Svg(props: IconProps & { children: unknown }) {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children as never}
    </svg>
  );
}

export function IconVolume(props: IconProps) {
  return (
    <Svg size={props.size}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Svg>
  );
}

export function IconVolumeMuted(props: IconProps) {
  return (
    <Svg size={props.size}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </Svg>
  );
}

export function IconDice(props: IconProps) {
  return (
    <Svg size={props.size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M8 8h.01" />
      <path d="M16 8h.01" />
      <path d="M12 12h.01" />
      <path d="M8 16h.01" />
      <path d="M16 16h.01" />
    </Svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Svg size={props.size}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg size={props.size}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Svg size={props.size}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </Svg>
  );
}

export function IconFastForward(props: IconProps) {
  return (
    <Svg size={props.size}>
      <polygon points="13 19 22 12 13 5 13 19" />
      <polygon points="2 19 11 12 2 5 2 19" />
    </Svg>
  );
}

export function IconSprout(props: IconProps) {
  return (
    <Svg size={props.size}>
      <path d="M7 20h10" />
      <path d="M10 20c5.5-2.5.8-6.4 3-10" />
      <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
      <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1.2 1.6-2.9 1.7-5.6-2.7.1-4 1-4.9 3z" />
    </Svg>
  );
}
