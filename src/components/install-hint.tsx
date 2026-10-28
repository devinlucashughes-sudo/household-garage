"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
/** True in iPhone Safari when the app isn't yet running from the Home Screen. */
function needsInstall() {
  const nav = navigator as Navigator & { standalone?: boolean };
  const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return iPhone && !nav.standalone && !matchMedia("(display-mode: standalone)").matches;
}

export function InstallHint() {
  const show = useSyncExternalStore(subscribe, needsInstall, () => false);
  if (!show) return null;
  return (
    <p className="notice">
      <strong>Add it to your Home Screen.</strong> Tap Share, then “Add to Home Screen”. Open it
      from there and sign in once.
    </p>
  );
}
