import { Button } from '@/components/ui/button';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import type { Product } from '@/types/product';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export interface ReviewUrlInputProps {
  onLoaded: (product: Product) => void;
}

export function ReviewUrlInput({ onLoaded }: ReviewUrlInputProps) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await sendRuntimeMessage<{
        ok?: boolean;
        product?: Product;
        error?: string;
      }>({
        type: 'LOAD_REVIEW_PRODUCT',
        payload: { input: trimmed },
      });

      if (!res?.ok || !res.product) {
        setError(res?.error ?? 'Не удалось загрузить товар');
        return;
      }

      onLoaded(res.product);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить товар');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="pg-hint font-medium text-foreground">Открыть по ссылке или артикулу WB</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="Ссылка или артикул WB"
          disabled={loading}
          className="min-w-0 flex-1 rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none ring-primary focus:ring-1 disabled:opacity-60"
        />
        <Button
          type="button"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={loading || !value.trim()}
          onClick={() => void handleSubmit()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Открыть
        </Button>
      </div>
      {error ? <p className="pg-caption text-destructive">{error}</p> : null}
    </div>
  );
}
