type FeatureVisualProps = {
  src: string;
  alt: string;
  index: number;
  kind?: "map" | "panel" | "note" | "sync";
};

export function FeatureVisual({ src, alt, index, kind = "map" }: FeatureVisualProps) {
  return (
    <div className={`feature-visual feature-visual-${kind}`}>
      <img src={src} alt={alt} />
      <span className="feature-number">0{index}</span>
      {kind === "sync" ? <span className="sync-badge"><i /> 已同步</span> : null}
    </div>
  );
}
