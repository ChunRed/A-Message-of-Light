import Link from "next/link";

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-white text-[#111111]">
      {/* Top-right minimalist engineering entry button to /keystroke-test */}
      <Link
        href="/keystroke-test"
        aria-label="Keystroke Dynamics Telemetry"
        title="SYS.TELEMETRY // Keystroke Dynamics"
        className="group fixed top-5 right-5 z-20 flex h-9 w-9 items-center justify-center border border-[#D4D4D8] bg-white text-[#52525B] transition-colors hover:border-[#111111] hover:text-[#111111] active:bg-[#FAFAFA]"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Crosshair ticks */}
          <path
            d="M9 1.5V4M9 14V16.5M1.5 9H4M14 9H16.5"
            stroke="currentColor"
            strokeWidth="1"
          />
          {/* Mini telemetry waveform inside reticle */}
          <path
            d="M4.5 9H6.2L7.3 6.2L8.9 11.8L10.3 7.6L11.4 9H13.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          {/* Corner registration marks */}
          <path
            d="M2 4.5V2H4.5M13.5 2H16V4.5M16 13.5V16H13.5M4.5 16H2V13.5"
            stroke="currentColor"
            strokeWidth="0.75"
            opacity="0.45"
          />
        </svg>
      </Link>

      {/* Top-centered logo */}
      <header className="flex w-full justify-center pt-10">
        <div className="select-none text-center">
          <h1 className="text-2xl font-medium tracking-widest">
            「一則光的訊息」
          </h1>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-neutral-500">
            a message of light
          </p>
        </div>
      </header>
    </div>
  );
}
