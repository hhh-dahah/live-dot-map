import { CopyPromptButton } from "../components/CopyPromptButton";
import { FeatureVisual } from "../components/FeatureVisual";
import { HeroArt } from "../components/HeroArt";
import { Reveal } from "../components/Reveal";

const AGENT_PROMPT =
  "读取 https://livedotmap.top/agent-kit/setup.md 并严格执行其中的指引，把活点地图接入我当前的项目。";

const features = [
  {
    title: "节点和方案线，分清目标与尝试",
    description: "节点只保留结构，每次尝试都沿着方案线留下结果。探索可以失败、回退，也可以走出新的问题路线。",
    src: "/media/canvas-map.png",
    alt: "活点地图中展示多条路线与方案线",
    kind: "map" as const,
  },
  {
    title: "便签、评分，结论随手留下",
    description: "把判断挂在地图上，成功、失败和待验证一眼区分；结果可以打分、归档，但不会从历史里消失。",
    src: "/media/canvas-note.png",
    alt: "活点地图中选中节点并查看便签和菜单",
    kind: "note" as const,
  },
  {
    title: "本地文件，和 Agent 共享一张图",
    description: "地图与 Markdown 留在你的项目目录。不同 Agent，都能读到同一份探索记忆。",
    src: "/media/canvas-panel.png",
    alt: "活点地图属性面板与本地项目地图",
    kind: "panel" as const,
  },
  {
    title: "打开项目文件夹，自动同步",
    description: "你和 Agent 改的是同一份地图。画布上的变化会保存回项目，Agent 的更新也会回到画布。",
    src: "/media/canvas-loaded.png",
    alt: "活点地图画布已打开并连接项目",
    kind: "sync" as const,
  },
];

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-nav">
        <div className="wide-wrap nav-inner">
          <a className="brand" href="#top" aria-label="活点地图首页">
            <span className="brand-mark"><i /><i /><b /></span>
            <span>活点地图</span>
          </a>
          <nav className="nav-links" aria-label="主导航">
            <a href="#features">功能</a>
            <a href="#join">接入</a>
            <a href="agent-kit/index.html">说明</a>
            <a className="nav-github" href="https://github.com/hhh-dahah/live-dot-map" target="_blank" rel="noreferrer">GitHub</a>
            <a className="nav-open" href="app.html">打开画布</a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <HeroArt />
          <div className="wide-wrap hero-copy">
            <p className="eyebrow">一张和 Agent 共同维护的探索地图</p>
            <h1>人机<span>协作</span> 变得简单</h1>
            <p className="hero-sub">探索 记录 回忆 · 一切尽在 livedotmap</p>
            <div className="hero-actions">
              <CopyPromptButton label="一键接入 Agent" prompt={AGENT_PROMPT} />
              <a className="button button-secondary" href="app.html">打开画布</a>
            </div>
            <a className="star-button" href="https://github.com/hhh-dahah/live-dot-map" target="_blank" rel="noreferrer">
              <span aria-hidden="true">★</span> 给我们一个 GitHub 星标
            </a>
            <div className="hero-promises" aria-label="产品特点">
              <span>本地优先</span><span>免费开源</span><span>不需要账号</span>
            </div>
          </div>
          <div className="hero-media wide-media">
            <div className="media-topline"><span /><span /><span /><em>live-dot-map</em></div>
            <img src="/media/landing-hero.png" alt="活点地图探索画布展示" />
          </div>
        </section>

        <section className="join-section" id="join">
          <Reveal className="join-inner wide-wrap">
            <div>
              <p className="section-kicker">01 · 接入</p>
              <h2>把活点地图接入你的项目</h2>
              <p className="join-copy">复制一句话，发给你正在使用的本地 Agent。剩下的接入工作交给它。</p>
            </div>
            <CopyPromptButton label="复制安装提示词" prompt={AGENT_PROMPT} />
          </Reveal>
        </section>

        <section className="features-section" id="features">
          <div className="wide-wrap section-intro">
            <p className="section-kicker">02 · 功能</p>
            <h2>把探索过程，变成一眼能看的地图</h2>
            <p>画布只保留结构和状态，细节留在本地文件里。</p>
          </div>
          <div className="feature-list wide-wrap">
            {features.map((feature, index) => (
              <Reveal className={`feature-row ${index % 2 ? "feature-row-reverse" : ""}`} key={feature.title} delay={index * 0.04}>
                <FeatureVisual src={feature.src} alt={feature.alt} index={index + 1} kind={feature.kind} />
                <div className="feature-copy">
                  <p className="feature-kicker">0{index + 1}</p>
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
              <p className="section-kicker">03 · 本地优先</p>
              <h2>你的项目，你的记忆</h2>
              <p>地图数据和 Markdown 都在你自己的项目目录里。没有账号，没有云数据库，换一个 Agent 也能继续。</p>
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
          <Reveal className="cta-inner">
            <p className="section-kicker">04 · 开始</p>
            <h2>让 Agent 先看懂，再开始工作</h2>
            <p>从下一次会话开始，它先汇报全局。</p>
            <CopyPromptButton label="一键接入 Agent" prompt={AGENT_PROMPT} />
          </Reveal>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wide-wrap footer-inner">
          <div className="footer-brand">
            <a className="brand brand-footer" href="#top"><span className="brand-mark"><i /><i /><b /></span><span>活点地图</span></a>
            <p>人和 Agent 共享同一张探索地图。</p>
            <small>免费开源 · MIT 许可证 · 本地优先</small>
          </div>
          <div className="footer-links">
            <div><span>Explore</span><a href="#features">功能</a><a href="#join">接入</a></div>
            <div><span>Product</span><a href="app.html">打开画布</a><a href="agent-kit/index.html">接入说明</a></div>
            <div><span>Contact</span><a href="https://github.com/hhh-dahah/live-dot-map" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/hhh-dahah/live-dot-map/issues" target="_blank" rel="noreferrer">反馈问题</a></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
