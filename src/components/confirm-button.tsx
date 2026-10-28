"use client";

import { useTransition } from "react";

/** A small destructive button that asks first, then runs a server action. */
export function ConfirmButton({
  action,
  question,
  children,
  className = "link-button link-button--danger",
}: {
  action: () => Promise<void>;
  question: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        if (confirm(question)) start(() => action());
      }}
    >
      {children}
    </button>
  );
}
