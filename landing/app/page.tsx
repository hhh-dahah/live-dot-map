import { DownloadSimple, Star } from "@phosphor-icons/react/dist/ssr";
import { FeatureVisual } from "../components/FeatureVisual";
import { HeroArt } from "../components/HeroArt";
import { HeroMedia } from "../components/HeroMedia";
import { Logo } from "../components/Logo";
import { Nav } from "../components/Nav";
import { Reveal } from "../components/Reveal";

const WINDOWS_DOWNLOAD_URL =
  "https://github.com/hhh-dahah/live-dot-map/releases/download/v2.0.0-rc.2/LiveDotMapSetup.exe";

const GITHUB_URL = "https://github.com/hhh-dahah/live-dot-map";

type Feature = {
  title: string;
  description: string;
  src: string;
  alt: string;
  layout: "split" | "center";
  reverse?: boolean;
};

const features: Feature[] = [
  {
    title: "项目记忆可视化",
    description:
      "Agent 和您都可以把项目的目标、尝试和结论画在一张地图上，不用翻聊天记录就能看清进展。",
    src: "/media/feature-1.png",
    alt: "活点地图画布：节点与方案线组成的项目记忆地图",
    layout: "split",
  },
  {
    title: "极度节省上下文",
    description:
      "节点记概要，后端包记详细信息；Agent 智能索引，智慧又省钱，麻麻再也不用担心我的钱包啦。",
    src: "/media/feature-2.png",
    alt: "节点详情：策展后收进 Markdown 文件的记忆细节",
    layout: "split",
    reverse: true,
  },
  {
    title: "不同任务整合思考，一键切换打通记忆",
    description:
      "切换不同记忆地图，Agent 自动读取多任务历史，实现跨项目联合推理，不用重新输入另一任务信息。",
    src: "/media/feature-3.png",
    alt: "在当前项目的多张记忆地图之间一键切换",
    layout: "center",
  },
  {
    title: "全新对话，也能调取过往思考细节",
    description:
      "开启全新对话时，Agent 可以定位到指定记忆节点，快速调取当时的判断、方案与结论，不用从头回忆历史。",
    src: "/media/feature-4.png",
    alt: "把节点引用复制给 Agent，在新对话里继续探讨",
    layout: "split",
  },
  {
    title: "人机共用画布，双向同步思考进度",
    description:
      "你在地图上做的标注、修改，Agent 实时感知；Agent 产出的思考也自动回写到地图，人与 AI 同步推进思路。",
    src: "/media/feature-5.png",
    alt: "地图上的标注被 Agent 读到并回应",
    layout: "split",
    reverse: true,
  },
];

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
              <a className="button button-primary" href={WINDOWS_DOWNLOAD_URL}>
                <DownloadSimple size={16} weight="bold" />
                下载 Windows 版
              </a>
              <a
                className="star-button"
                href={GITHUB_URL}
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

        <section className="features-section" id="features">
          <div className="feature-list wide-wrap">
            {features.map((feature) => (
              <Reveal
                className={`feature-row ${feature.layout === "center" ? "feature-row-center" : ""} ${
                  feature.reverse ? "feature-row-reverse" : ""
                }`}
                key={feature.title}
              >
                <FeatureVisual src={feature.src} alt={feature.alt} />
                <div className="feature-copy">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="more-section" id="download">
          <Reveal className="more-inner wide-wrap">
            <h2>
              <span className="hl">还有更多……</span>
            </h2>
            <p className="more-line">亲自体验，现在免费开源；当前为 Alpha 版，迭代很快。</p>
            <p className="more-line">还缺少什么？请查看我们的 GitHub。</p>
            <div className="more-actions">
              <a className="button button-primary" href={WINDOWS_DOWNLOAD_URL}>
                <DownloadSimple size={16} weight="bold" />
                下载 Windows 版
              </a>
              <a
                className="star-button"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
              >
                <Star size={15} weight="fill" />
                给我们一个 GitHub 星标
              </a>
            </div>
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
            <small>免费开源 · Apache-2.0 许可证</small>
          </div>
          <div className="footer-links">
            <div>
              <span>Explore</span>
              <a href="#features">功能</a>
              <a href="#download">下载</a>
            </div>
            <div>
              <span>Product</span>
              <a href={WINDOWS_DOWNLOAD_URL}>下载 Windows 版</a>
              <a href="app.html">打开画布</a>
              <a href="agent-kit/index.html">接入说明</a>
            </div>
            <div>
              <span>Contact</span>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">反馈问题</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
