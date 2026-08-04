import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';

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

function focusTabButton(container: HTMLElement, index: number) {
  const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  const btn = buttons[index];
  btn?.focus();
}

export function Tabs({ tabs, activeTab, onChange, lockedTabIds = [] }: TabsProps) {
  const enabledIds = tabs
    .filter((t) => !lockedTabIds.includes(t.id))
    .map((t) => t.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabledIds.length === 0) return;
    const currentIdx = Math.max(0, enabledIds.indexOf(activeTab));
    let nextIdx = currentIdx;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      nextIdx = (currentIdx + 1) % enabledIds.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      nextIdx = (currentIdx - 1 + enabledIds.length) % enabledIds.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIdx = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIdx = enabledIds.length - 1;
    } else {
      return;
    }

    const nextId = enabledIds[nextIdx];
    onChange(nextId);
    focusTabButton(event.currentTarget, tabs.findIndex((t) => t.id === nextId));
  };

  return (
    <div
      className="flex gap-0 border-b border-border"
      role="tablist"
      aria-label="Разделы PriceGuard"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const isLocked = lockedTabIds.includes(tab.id);

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => !isLocked && onChange(tab.id)}
            disabled={isLocked}
            title={isLocked ? 'Дождитесь завершения AI-анализа' : tab.label}
            aria-label={isLocked ? `${tab.label} (заблокировано)` : tab.label}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 pb-2.5 pt-1 pg-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
              isLocked &&
                'cursor-not-allowed opacity-40 hover:text-muted-foreground',
            )}
          >
            <Icon
              className={cn('h-[18px] w-[18px]', isActive && 'text-primary')}
              strokeWidth={isActive ? 2 : 1.75}
              aria-hidden
            />
            <span className="w-full truncate text-center text-[10px] font-medium leading-tight">
              {tab.label}
            </span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="absolute right-0.5 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                {tab.badge > 9 ? '9+' : tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
