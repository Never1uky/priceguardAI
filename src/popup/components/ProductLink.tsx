import { loadReferralSettings } from '@/lib/referral-settings';
import { makeReferralLink } from '@/utils/referral';
import { safeMarketplaceHref } from '@/utils/safe-marketplace-url';
import type { Marketplace } from '@/types/product';
import { useEffect, useState } from 'react';

interface ProductLinkProps {
  url: string;
  marketplace?: Marketplace;
  className?: string;
  title?: string;
  'aria-label'?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  children: React.ReactNode;
}

/**
 * Внешняя ссылка на товар с актуальными реферальными параметрами.
 * Обновляется при изменении настроек в chrome.storage.
 */
export function ProductLink({
  url,
  marketplace,
  className,
  title,
  'aria-label': ariaLabel,
  onClick,
  children,
}: ProductLinkProps) {
  const [href, setHref] = useState(() =>
    safeMarketplaceHref(makeReferralLink(url, marketplace), marketplace),
  );

  useEffect(() => {
    const refresh = () => {
      void loadReferralSettings().then(() => {
        setHref(safeMarketplaceHref(makeReferralLink(url, marketplace), marketplace));
      });
    };

    refresh();

    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.priceguard_referral_settings) {
        refresh();
      }
    };

    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [url, marketplace]);

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
