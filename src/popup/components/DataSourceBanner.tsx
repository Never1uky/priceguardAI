import type { ProductDataSource } from '@/popup/hooks/useLiveProduct';

import { Globe, HardDrive, Loader2 } from 'lucide-react';



interface DataSourceBannerProps {

  dataSource: ProductDataSource;

  tabUrl?: string | null;

}



export function DataSourceBanner({ dataSource, tabUrl }: DataSourceBannerProps) {

  if (dataSource === 'none') return null;



  const config =

    dataSource === 'current_tab'

      ? {

          Icon: Globe,

          className:

            'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',

          title: 'Данные с текущей вкладки',

        }

      : dataSource === 'cached'

        ? {

            Icon: HardDrive,

            className:

              'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-200',

            title: 'Данные из кэша — откройте карточку или нажмите «Обновить»',

          }

        : {

            Icon: Loader2,

            className:

              'border-border/60 bg-muted/30 text-muted-foreground',

            title: 'Обновление данных…',

          };



  return (

    <div

      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] ${config.className}`}

      title={tabUrl ?? undefined}

    >

      <config.Icon

        className={`h-3.5 w-3.5 shrink-0 ${dataSource === 'loading' ? 'animate-spin' : ''}`}

      />

      <p className="font-medium leading-snug">{config.title}</p>

    </div>

  );

}


