import { Button } from '@/components/ui/button';
import {
  TELEGRAM_CHANNEL_LINK_LABEL,
  TELEGRAM_CHANNEL_URL,
} from '@/lib/chrome-store';
import { Newspaper } from 'lucide-react';

type Props = {
  /** outline = заметно в empty state; ghost = рядом с поддержкой; link = текстовая ссылка */
  variant?: 'outline' | 'ghost' | 'link';
  className?: string;
  size?: 'sm' | 'default' | 'lg';
};

/** Открывает канал с разборами — отдельно от алертов о цене. */
export function TelegramChannelLink({
  variant = 'outline',
  className,
  size = 'sm',
}: Props) {
  const open = () => {
    void chrome.tabs.create({ url: TELEGRAM_CHANNEL_URL });
  };

  if (variant === 'link') {
    return (
      <a
        href={TELEGRAM_CHANNEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={
          className ??
          'inline-flex items-center gap-1 pg-hint font-medium text-primary hover:underline'
        }
        onClick={(e) => {
          e.preventDefault();
          open();
        }}
      >
        {TELEGRAM_CHANNEL_LINK_LABEL}
      </a>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className ?? 'w-full justify-start gap-2'}
      onClick={open}
    >
      <Newspaper className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      {TELEGRAM_CHANNEL_LINK_LABEL}
      <span className="ml-auto pg-caption text-muted-foreground">t.me/priceguard_ai</span>
    </Button>
  );
}
