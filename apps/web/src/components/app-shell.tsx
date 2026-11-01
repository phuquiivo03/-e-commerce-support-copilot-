'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, BookOpen, Gauge, LogOut, ShieldCheck, Bot } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { UserRole } from '@copilot/shared';
import { cn } from '@/components/ui/button';

const NAV = [
  { href: '/inbox', label: 'Inbox', icon: ClipboardList, roles: ['ADMIN', 'SUPPORT_AGENT'] as UserRole[] },
  { href: '/kb', label: 'Knowledge Base', icon: BookOpen, roles: ['ADMIN'] as UserRole[] },
  { href: '/eval', label: 'Evaluation', icon: Gauge, roles: ['ADMIN', 'SUPPORT_AGENT'] as UserRole[] },
];

export function AppShell({
  role,
  fullName,
  children,
}: {
  role: UserRole;
  fullName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.push('/login');
  };

  const items = NAV.filter((item) => item.roles.includes(role));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-muted">
        <div className="flex items-center gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight">Support Copilot</div>
            <div className="text-xs font-medium text-muted-foreground">Demo Store</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-all duration-200',
                  active ? 'bg-primary text-white' : 'text-foreground hover:bg-muted-hover'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 p-4">
          <div className="rounded-md bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-bold">{fullName}</div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
              {role.replace('_', ' ')}
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors duration-200 hover:bg-muted-hover hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
