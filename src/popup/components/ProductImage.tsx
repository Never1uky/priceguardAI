import { useEffect, useState } from 'react';

export interface ProductImageSource {
  title?: string;
  imageUrl?: string;
  imageUrlAlternatives?: string[];
}

interface ProductImageProps {
  product: ProductImageSource;
  className?: string;
  /** Smaller placeholder text for list thumbs */
  compact?: boolean;
}

/**
 * Product thumb with CDN fallbacks.
 * Never shows native broken-image + alt text overlay — skeleton until load, then «Нет фото».
 */
export function ProductImage({
  product,
  className = 'h-20 w-20',
  compact = false,
}: ProductImageProps) {
  const sources = [
    product.imageUrl,
    ...(product.imageUrlAlternatives ?? []),
  ].filter((url): url is string => Boolean(url));

  const [sourceIndex, setSourceIndex] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const sourcesKey = sources.join('|');

  useEffect(() => {
    setSourceIndex(0);
    setExhausted(false);
    setLoaded(false);
  }, [sourcesKey]);

  const currentSrc = !exhausted ? sources[sourceIndex] : undefined;
  const showSkeleton = Boolean(currentSrc) && !loaded;
  const showEmpty = !currentSrc;

  if (showEmpty) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-xl border bg-muted text-muted-foreground ${className} ${
          compact ? 'text-[9px]' : 'text-xs'
        }`}
        aria-hidden
      >
        Нет фото
      </div>
    );
  }

  return (
    <div className={`relative shrink-0 overflow-hidden rounded-xl border ${className}`}>
      {showSkeleton && (
        <div
          className="absolute inset-0 animate-pulse bg-muted"
          aria-hidden
        />
      )}
      <img
        src={currentSrc}
        alt=""
        decoding="async"
        className={`h-full w-full object-cover ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity`}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          if (sourceIndex < sources.length - 1) {
            setSourceIndex((i) => i + 1);
          } else {
            setExhausted(true);
          }
        }}
      />
    </div>
  );
}
