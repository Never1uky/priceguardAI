import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface TabItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  lockedTabIds?: string[];
}

export function Tabs({ tabs, activeTab, onChange, lockedTabIds = [] }: TabsProps) {
  return (
    <div className="flex gap-1 rounded-md bg-muted/60 p-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const isLocked = lockedTabIds.includes(tab.id);

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => !isLocked && onChange(tab.id)}
            disabled={isLocked}
            title={isLocked ? 'Дождитесь завершения AI-анализа' : tab.label}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm px-1 py-2 pg-transition',
              isActive
                ? 'bg-card text-foreground shadow-soft'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
              isLocked &&
                'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2 : 1.75} />
            <span className="w-full truncate text-center text-[10px] font-medium leading-tight">
              {tab.label}
            </span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                {tab.badge > 9 ? '9+' : tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
