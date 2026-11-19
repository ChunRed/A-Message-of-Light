import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

export function PaperPlaneIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M17.5 3L2.5 9.2L8.4 11.4L17.5 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 3L12.6 17L8.4 11.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EraserIcon({ className = "", size = 17 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M11.6 4.1L16.3 8.8C16.9 9.4 16.9 10.4 16.3 11L11.2 16.1H6.1L3.7 13.7C3.1 13.1 3.1 12.1 3.7 11.5L9.4 5.8L11.6 4.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.6 7.7L12.7 12.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 16.1H17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TrashIcon({ className = "", size = 17 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3.8 5.6H16.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7.5 5.6V4.1C7.5 3.55 7.95 3.1 8.5 3.1H11.5C12.05 3.1 12.5 3.55 12.5 4.1V5.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.3 5.6L6.1 15.6C6.18 16.38 6.83 17 7.62 17H12.38C13.17 17 13.82 16.38 13.9 15.6L14.7 5.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 9V13.6M11.5 9V13.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EnvelopeCheckIcon({ className = "", size = 28 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Letter sheet emerging */}
      <path
        d="M7.5 13V5.5C7.5 4.95 7.95 4.5 8.5 4.5H19.5C20.05 4.5 20.5 4.95 20.5 5.5V13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Checkmark inside letter */}
      <path
        d="M11.5 9.8L13.3 11.6L16.9 7.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Envelope body */}
      <path
        d="M4.5 11.2L7.5 9.2M23.5 11.2L20.5 9.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 11.2V22C4.5 22.83 5.17 23.5 6 23.5H22C22.83 23.5 23.5 22.83 23.5 22V11.2L14 17.5L4.5 11.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 22.8L11.2 15.8M22.8 22.8L16.8 15.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadIcon({ className = "", size = 15 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 3.5V13M10 13L6.4 9.5M10 13L13.6 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16H16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EditBackIcon({ className = "", size = 15 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M13.5 4.2L15.8 6.5L7.6 14.7L4.4 15.6L5.3 12.4L13.5 4.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrushLabIcon({ className = "", size = 17 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Minimalist calligraphic nib + precision slider ticks */}
      <path
        d="M11.8 3.2L16.2 7.6L9.4 14.4L4.2 15.8L5.6 10.6L11.8 3.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.8 5.6L13.8 9.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4.2 17.2H16.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="13" cy="17.2" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function StampPostmarkDecoration({ className = "" }: { className?: string }) {
  return (
    <svg
      width="74"
      height="46"
      viewBox="0 0 74 46"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Wavy postmark cancel lines */}
      <path
        d="M2 15C9 12 15 18 22 15C27 13 31 15 35 15"
        stroke="#8C8C8A"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M4 22C11 19 17 25 24 22C29 20 33 22 37 22"
        stroke="#8C8C8A"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M2 29C9 26 15 32 22 29C27 27 31 29 35 29"
        stroke="#8C8C8A"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.6"
      />

      {/* Perforated postage stamp frame */}
      <rect
        x="38"
        y="3"
        width="33"
        height="40"
        stroke="#B9B9B4"
        strokeWidth="1"
        strokeDasharray="2.5 2.5"
      />
      <rect
        x="42"
        y="7"
        width="25"
        height="32"
        stroke="#E2E2DE"
        strokeWidth="1"
      />

      {/* Minimalist light-ray geometric sun motif */}
      <circle cx="54.5" cy="23" r="4.2" stroke="#8C8C8A" strokeWidth="1" />
      <path
        d="M54.5 14V16.4M54.5 29.6V32M45.5 23H47.9M61.1 23H63.5M48.2 16.7L49.9 18.4M59.1 27.6L60.8 29.3M60.8 16.7L59.1 18.4M49.9 27.6L48.2 29.3"
        stroke="#8C8C8A"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
