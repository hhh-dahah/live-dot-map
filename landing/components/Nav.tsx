"use client";

import { GithubLogo } from "@phosphor-icons/react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Logo } from "./Logo";

export function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 24);
  });

  return (
    <header className={`site-nav ${scrolled ? "is-scrolled" : ""}`}>
      <div className="wide-wrap nav-inner">
        <a className="brand" href="#top" aria-label="活点地图首页">
          <Logo size={25} />
          <span>活点地图</span>
        </a>
        <nav className="nav-links" aria-label="主导航">
          <a href="#features">功能</a>
          <a href="#download">下载</a>
          <a href="agent-kit/index.html">说明</a>
          <a
            className="nav-github"
            href="https://github.com/hhh-dahah/live-dot-map"
            target="_blank"
            rel="noreferrer"
          >
            <GithubLogo size={16} weight="bold" />
            GitHub
          </a>
          <a className="nav-open" href="app.html">打开画布</a>
        </nav>
      </div>
    </header>
  );
}
