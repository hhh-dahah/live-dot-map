type LogoProps = {
  size?: number;
  className?: string;
};

/** 活点地图 logo：两个圆节点 + 一条方案线，提炼自 icons/icon-192.png。 */
export function Logo({ size = 26, className = "" }: LogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.4 20.6 L20.6 11.4"
        stroke="var(--landing-accent)"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <circle cx="9" cy="23" r="5.6" stroke="currentColor" strokeWidth="3" />
      <circle cx="23" cy="9" r="5.6" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
