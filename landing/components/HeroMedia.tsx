"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import type { MouseEvent } from "react";

/** Hero 产品截图组合：大图 + 两侧小图扇形展开，鼠标视差只走 motion value。 */
export function HeroMedia() {
  const reduceMotion = useReducedMotion();

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 55, damping: 16, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 55, damping: 16, mass: 0.6 });

  const mainX = useTransform(sx, (v) => v * 12);
  const mainY = useTransform(sy, (v) => v * 8);
  const miniX = useTransform(sx, (v) => v * -20);
  const miniY = useTransform(sy, (v) => v * -12);

  function handleMove(event: MouseEvent<HTMLDivElement>) {
    if (reduceMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    mx.set((event.clientX - rect.left) / rect.width - 0.5);
    my.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function handleLeave() {
    mx.set(0);
    my.set(0);
  }

  const drift = reduceMotion ? {} : { x: mainX, y: mainY };
  const driftMini = reduceMotion ? {} : { x: miniX, y: miniY };

  return (
    <div
      className="hero-media-wrap wide-media rise rise-4"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="arrow-cursor" aria-hidden="true">
        <svg viewBox="0 0 36 54" fill="none">
          <path
            d="M9 5 L29 25.5 L20.5 27.5 L26.5 43 L21.5 45.5 L15.5 30 L8 36.5 Z"
            fill="white"
            stroke="#030064"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <motion.div
        className="hero-collab hero-collab-left"
        style={{ ...driftMini, rotate: -5 }}
        aria-hidden="true"
      >
        <div className="collab-inner">
          <svg viewBox="0 0 36 54" fill="none">
            <path
              d="M9 5 L29 25.5 L20.5 27.5 L26.5 43 L21.5 45.5 L15.5 30 L8 36.5 Z"
              fill="currentColor"
              stroke="white"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          </svg>
          <span className="collab-tag">你</span>
        </div>
      </motion.div>
      <motion.div
        className="hero-collab hero-collab-right"
        style={{ ...driftMini, rotate: 4 }}
        aria-hidden="true"
      >
        <div className="collab-inner">
          <svg viewBox="0 0 36 54" fill="none">
            <path
              d="M9 5 L29 25.5 L20.5 27.5 L26.5 43 L21.5 45.5 L15.5 30 L8 36.5 Z"
              fill="currentColor"
              stroke="white"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          </svg>
          <span className="collab-tag">Agent</span>
        </div>
      </motion.div>
      <motion.div className="hero-media" style={drift}>
        <div className="media-topline" aria-hidden="true">
          <span /><span /><span /><em>live-dot-map</em>
        </div>
        <img src="/media/landing-hero.png" alt="活点地图探索画布展示" fetchPriority="high" />
      </motion.div>
    </div>
  );
}
