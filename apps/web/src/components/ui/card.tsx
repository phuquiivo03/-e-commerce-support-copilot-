import * as React from 'react';
import { cn } from './button';

/**
 * Flat "color block" card: solid background, generous padding, rounded-lg,
 * NO shadow, NO border. Hover = subtle scale + optional tint intensification.
 */
export function Card({
  className,
  interactive = false,
  tint = 'white',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  tint?: 'white' | 'muted' | 'primarySoft' | 'secondarySoft' | 'accentSoft';
}) {
  const tintClass = {
    white: 'bg-background',
    muted: 'bg-muted',
    primarySoft: 'bg-primary-soft',
    secondarySoft: 'bg-secondary-soft',
    accentSoft: 'bg-accent-soft',
  }[tint];

  return (
    <div
      className={cn(
        'rounded-lg p-6',
        tintClass,
        interactive && 'cursor-pointer transition-all duration-200 hover:scale-[1.02]',
        className
      )}
      {...props}
    />
  );
}

/** Solid colored icon disc used across the design system. */
export function IconDisc({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-white transition-transform duration-200',
        className
      )}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
