"use client";

import { motion, useReducedMotion } from "motion/react";

export function HeroArt() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="hero-art" aria-hidden="true">
      <motion.svg
        className="hero-scribble hero-scribble-one"
        viewBox="0 0 180 120"
        fill="none"
        initial={reduceMotion ? false : { opacity: 0, pathLength: 0 }}
        animate={reduceMotion ? undefined : { opacity: 1, pathLength: 1 }}
        transition={{ duration: 1.1, delay: 0.15 }}
      >
        <path d="M11 85c25-48 43-40 66-16 22 23 34 19 48-6 13-24 26-27 45-12" />
        <path d="M33 104c29-25 47-17 63-1" />
      </motion.svg>
      <motion.svg
        className="hero-scribble hero-scribble-two"
        viewBox="0 0 130 100"
        fill="none"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.86 }}
        animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.75, delay: 0.35 }}
      >
        <path d="M16 43c24-31 60-38 95-16" />
        <circle cx="28" cy="72" r="7" />
        <circle cx="105" cy="62" r="4" />
      </motion.svg>
      <span className="hero-sticker hero-sticker-left">keep the thread</span>
      <span className="hero-sticker hero-sticker-right">human + agent</span>
      <span className="hero-dot hero-dot-one" />
      <span className="hero-dot hero-dot-two" />
    </div>
  );
}
