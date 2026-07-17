import { loadReferralSettings } from '@/lib/referral-settings';
import { makeReferralLink } from '@/utils/referral';
import type { Marketplace } from '@/types/product';
import { useEffect, useState } from 'react';

interface ProductLinkProps {
  url: string;
  marketplace?: Marketplace;
  className?: string;
  title?: string;
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
  onClick,
  children,
}: ProductLinkProps) {
  const [href, setHref] = useState(() => makeReferralLink(url, marketplace));

  useEffect(() => {
    const refresh = () => {
      void loadReferralSettings().then(() => {
        setHref(makeReferralLink(url, marketplace));
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

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={title}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
