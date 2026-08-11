import type { ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
};

/** 滚动显现容器：动画由纯 CSS scroll-driven animation 承担（见 globals.css 的 .reveal）。
    不依赖 JS——即使页面脚本没有执行，内容也始终可见。 */
export function Reveal({ children, className = "" }: RevealProps) {
  return <div className={`reveal ${className}`}>{children}</div>;
}
