"use client";

import { useState } from "react";

type CopyPromptButtonProps = {
  label: string;
  prompt: string;
  className?: string;
};

export function CopyPromptButton({ label, prompt, className = "" }: CopyPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
      } else {
        throw new Error("clipboard unavailable");
      }
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      className={`button button-primary ${className}`}
      type="button"
      onClick={copyPrompt}
      aria-live="polite"
    >
      {copied ? "已复制 ✓" : label}
    </button>
  );
}
