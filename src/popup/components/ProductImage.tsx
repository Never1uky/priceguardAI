import { useState } from 'react';
import type { Product } from '@/types/product';

interface ProductImageProps {
  product: Product;
  className?: string;
}

export function ProductImage({ product, className = 'h-20 w-20' }: ProductImageProps) {
  const sources = [
    product.imageUrl,
    ...(product.imageUrlAlternatives ?? []),
  ].filter((url): url is string => Boolean(url));

  const [sourceIndex, setSourceIndex] = useState(0);
  const currentSrc = sources[sourceIndex];

  if (!currentSrc) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-xl border bg-muted text-xs text-muted-foreground ${className}`}
      >
        Нет фото
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={product.title}
      className={`shrink-0 rounded-xl border object-cover ${className}`}
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex((i) => i + 1);
        }
      }}
    />
  );
}
