/** The wrench app icon, drawn inline so it never waits on a request. Same art as public/icon.svg. */
export function AppIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="app-icon">
      <rect width="32" height="32" rx="7" fill="#16141a" />
      <g transform="rotate(45 16 16)">
        <mask id="app-icon-jaw">
          <rect width="32" height="32" fill="#fff" />
          <rect x="13.25" y="0" width="5.5" height="9.5" fill="#000" />
        </mask>
        <g fill="#ff9a3c" mask="url(#app-icon-jaw)">
          <circle cx="16" cy="10" r="6.75" />
          <rect x="13.25" y="13" width="5.5" height="15.5" rx="2.75" />
        </g>
      </g>
    </svg>
  );
}
