/** Hero 手绘装饰：曲线、圆点、手写小注。动画全部由 CSS 承担，reduced-motion 下静止。 */
export function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg className="hero-scribble hero-scribble-one" viewBox="0 0 180 120" fill="none">
        <path d="M11 85c25-48 43-40 66-16 22 23 34 19 48-6 13-24 26-27 45-12" />
        <path d="M33 104c29-25 47-17 63-1" />
      </svg>
      <svg className="hero-scribble hero-scribble-two" viewBox="0 0 130 100" fill="none">
        <path d="M16 43c24-31 60-38 95-16" />
        <circle cx="28" cy="72" r="7" />
        <circle cx="105" cy="62" r="4" />
      </svg>
      <span className="hero-sticker hero-sticker-left hand">keep the thread</span>
      <span className="hero-dot hero-dot-one" />
      <span className="hero-dot hero-dot-two" />
    </div>
  );
}
