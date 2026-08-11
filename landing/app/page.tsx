import { Check, Star } from "@phosphor-icons/react/dist/ssr";
import { CopyPromptButton } from "../components/CopyPromptButton";
import { FeatureVisual } from "../components/FeatureVisual";
import { HeroArt } from "../components/HeroArt";
import { HeroMedia } from "../components/HeroMedia";
import { Logo } from "../components/Logo";
import { Nav } from "../components/Nav";
import { Reveal } from "../components/Reveal";

const AGENT_PROMPT =
  "读取 https://livedotmap.top/agent-kit/setup.md 并严格执行其中的指引，把活点地图接入我当前的项目。";

const features = [
  {
    title: "节点和方案线，分清目标与尝试",
    description: "节点只保留结构，每次尝试都沿着方案线留下结果。探索可以失败、回退，也可以走出新的问题路线。",
    src: "/media/canvas-map-crop.png",
    alt: "活点地图中展示多条路线与方案线",
    layout: "center" as const,
    sync: false,
  },
  {
    title: "便签、评分，结论随手留下",
    description: "把判断挂在地图上，成功、失败和待验证一眼区分；结果可以打分、归档，但不会从历史里消失。",
    src: "/media/canvas-note-crop.png",
    alt: "活点地图中选中节点并查看便签和菜单",
    layout: "split" as const,
    sync: false,
  },
  {
    title: "本地文件，和 Agent 共享一张图",
    description: "地图与 Markdown 留在你的项目目录。不同 Agent，都能读到同一份探索记忆。",
    src: "/media/canvas-panel-crop.png",
    alt: "活点地图属性面板与本地项目地图",
    layout: "center" as const,
    sync: false,
  },
  {
    title: "打开项目文件夹，自动同步",
    description: "你和 Agent 改的是同一份地图。画布上的变化会保存回项目，Agent 的更新也会回到画布。",
    src: "/media/canvas-loaded-crop.png",
    alt: "活点地图画布已打开并连接项目",
    layout: "split" as const,
    sync: true,
  },
];

const localChecks = ["本地优先", "免费开源", "不需要账号"];

export default function Home() {
  return (
    <div className="site-shell">
      <Nav />

      <main id="top">
        <section className="hero-section">
          <HeroArt />
          <div className="wide-wrap hero-copy">
            <h1 className="rise rise-1">
              人机<span className="hl">协作</span> 变得简单
            </h1>
            <p className="hero-sub rise rise-2">探索 记录 回忆 · 一切尽在 livedotmap</p>
            <div className="hero-actions rise rise-3">
              <CopyPromptButton label="一键接入 Agent" prompt={AGENT_PROMPT} />
              <a
                className="star-button"
                href="https://github.com/hhh-dahah/live-dot-map"
                target="_blank"
                rel="noreferrer"
              >
                <Star size={15} weight="fill" />
                给我们一个 GitHub 星标
              </a>
            </div>
          </div>
          <HeroMedia />
        </section>

        <section className="join-section" id="join">
          <Reveal className="join-inner wide-wrap">
            <span className="join-note hand" aria-hidden="true">
              one prompt, done
              <svg viewBox="0 0 40 44">
                <path d="M34 4 C 26 18, 18 28, 6 38 M6 38 l 10 -3 M6 38 l 2 -11" />
              </svg>
            </span>
            <h2>把活点地图接入你的项目</h2>
            <p className="join-copy">复制一句话，发给你正在使用的本地 Agent，剩下的接入工作交给它。</p>
            <CopyPromptButton label="复制安装提示词" prompt={AGENT_PROMPT} />
          </Reveal>
        </section>

        <section className="features-section" id="features">
          <div className="wide-wrap section-intro">
            <h2>把探索过程，变成一眼能看的地图</h2>
            <p>画布只保留结构和状态，细节留在本地文件里。</p>
          </div>
          <div className="feature-list wide-wrap">
            {features.map((feature, index) => (
              <Reveal
                className={`feature-row ${feature.layout === "center" ? "feature-row-center" : ""} ${
                  feature.layout === "split" && index === 3 ? "feature-row-reverse" : ""
                }`}
                key={feature.title}
              >
                <FeatureVisual src={feature.src} alt={feature.alt} sync={feature.sync} />
                <div className="feature-copy">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="local-section">
          <Reveal className="local-inner wide-wrap">
            <div className="local-copy">
              <h2>你的项目，你的记忆</h2>
              <p>地图数据和 Markdown 都留在你的项目目录里，换一个 Agent 也能接着读。</p>
              <div className="check-list" aria-label="产品特点">
                {localChecks.map((item) => (
                  <span className="check-item" key={item}>
                    <Check size={14} weight="bold" />
                    {item}
                  </span>
                ))}
              </div>
              <p className="local-note">判断权永远在人：评分你打，归档你确认。</p>
            </div>
            <div className="folder-card" aria-label="活点地图项目目录结构">
              <div>项目目录/</div>
              <div className="folder-indent"><strong>.live-dot-map/</strong></div>
              <div className="folder-indent folder-deep">map.json <span>探索地图</span></div>
              <div className="folder-indent folder-deep">nodes/ routes/ <span>Markdown 详情</span></div>
              <div>AGENTS.md <span>Agent 协议</span></div>
            </div>
          </Reveal>
        </section>

        <section className="bottom-cta">
          <Reveal className="cta-band">
            <h2>让 Agent 先看懂，再开始工作</h2>
            <p>从下一次会话开始，它先汇报全局。</p>
            <CopyPromptButton label="一键接入 Agent" prompt={AGENT_PROMPT} />
            <span className="hand" aria-hidden="true">one prompt away</span>
          </Reveal>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wide-wrap footer-inner">
          <div className="footer-brand">
            <a className="brand brand-footer" href="#top">
              <Logo size={25} />
              <span>活点地图</span>
            </a>
            <p>人和 Agent 共享同一张探索地图。</p>
            <small>免费开源 · MIT 许可证</small>
          </div>
          <div className="footer-links">
            <div>
              <span>Explore</span>
              <a href="#features">功能</a>
              <a href="#join">接入</a>
            </div>
            <div>
              <span>Product</span>
              <a href="app.html">打开画布</a>
              <a href="agent-kit/index.html">接入说明</a>
            </div>
            <div>
              <span>Contact</span>
              <a href="https://github.com/hhh-dahah/live-dot-map" target="_blank" rel="noreferrer">GitHub</a>
              <a href="https://github.com/hhh-dahah/live-dot-map/issues" target="_blank" rel="noreferrer">反馈问题</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
