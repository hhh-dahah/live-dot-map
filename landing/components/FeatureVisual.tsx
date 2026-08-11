type FeatureVisualProps = {
  src: string;
  alt: string;
  sync?: boolean;
};

export function FeatureVisual({ src, alt, sync = false }: FeatureVisualProps) {
  return (
    <div className="feature-visual">
      <img src={src} alt={alt} loading="lazy" />
      {sync ? (
        <span className="sync-badge">
          <i /> 已同步
        </span>
      ) : null}
    </div>
  );
}
