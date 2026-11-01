import * as React from 'react';
import { cn } from './button';

/** Flat input: gray-100 fill, no border; hard 2px primary border on focus. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-md bg-muted px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground',
        'border-2 border-transparent transition-colors duration-200',
        'focus:border-primary focus:bg-background focus:outline-none',
        'disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-24 w-full rounded-md bg-muted px-3.5 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground',
        'border-2 border-transparent transition-colors duration-200',
        'focus:border-primary focus:bg-background focus:outline-none',
        'disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full appearance-none rounded-md bg-muted px-3.5 text-[15px] font-medium text-foreground',
        'border-2 border-transparent transition-colors duration-200',
        'focus:border-primary focus:bg-background focus:outline-none',
        'disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs font-semibold uppercase tracking-wider text-muted-foreground', className)}
      {...props}
    />
  );
}
