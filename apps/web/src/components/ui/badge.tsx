import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './button';

/**
 * Flat badge: solid color block or soft tint, rounded-md (never a pill),
 * uppercase micro-label styling.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground',
        primary: 'bg-primary text-primary-foreground',
        primarySoft: 'bg-primary-soft text-primary',
        secondary: 'bg-secondary text-secondary-foreground',
        secondarySoft: 'bg-secondary-soft text-secondary',
        accent: 'bg-accent text-accent-foreground',
        accentSoft: 'bg-accent-soft text-accent-hover',
        destructive: 'bg-destructive text-destructive-foreground',
        destructiveSoft: 'bg-destructive-soft text-destructive',
        outline: 'border-2 border-current bg-transparent',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Maps ticket/order/priority enums to the flat palette. */
export function statusTone(status: string): NonNullable<BadgeProps['tone']> {
  switch (status) {
    case 'DELIVERED':
    case 'PAID':
    case 'RESOLVED':
    case 'APPROVED':
    case 'SUCCEEDED':
    case 'CLOSED':
      return 'secondary';
    case 'SHIPPED':
    case 'IN_TRANSIT':
    case 'IN_PROGRESS':
    case 'PROCESSING':
    case 'PENDING_REVIEW':
    case 'QUEUED':
      return 'primary';
    case 'OPEN':
    case 'PENDING':
    case 'RUNNING':
    case 'WAITING_ON_CUSTOMER':
      return 'accent';
    case 'ESCALATED':
    case 'URGENT':
    case 'FAILED':
    case 'EXCEPTION':
    case 'CANCELLED':
    case 'REJECTED':
      return 'destructive';
    case 'HIGH':
      return 'accentSoft';
    default:
      return 'neutral';
  }
}
