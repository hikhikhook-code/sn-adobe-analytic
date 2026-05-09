"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { LogOut, Sparkles, X } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { APP_NAME, PRIMARY_NAV, SECONDARY_NAV } from "@/lib/constants";
import { Avatar } from "@/components/ui/avatar";
import { useSidebar } from "@/components/layout/sidebar-context";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { open, setOpen } = useSidebar();

  // Close drawer on route change.
  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-30 bg-navy/60 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        aria-label="Primary navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col bg-navy text-white transition-transform lg:sticky lg:top-0 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between gap-2.5 px-5 pb-3 pt-6">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent-blue/20 text-accent-blue">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-semibold tracking-tight">{APP_NAME}</p>
              <p className="text-[11px] text-white/60">Adobe Stock Analytics</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-5 mt-2 flex items-center gap-3 rounded-xl bg-white/5 p-3">
          <Avatar
            fallback={session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? "G"}
            src={session?.user?.image}
            className="h-10 w-10 bg-white/10 text-white"
          />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">
              {session?.user?.name ?? session?.user?.email ?? "Guest"}
            </p>
            <p className="text-[11px] text-white/60">
              {session ? "Free plan" : "Not signed in"}
            </p>
          </div>
        </div>

        <nav className="mt-5 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
          <ul className="space-y-1">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-4 h-px bg-white/10" />

          <ul className="space-y-1">
            {SECONDARY_NAV.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              {session ? (
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/auth/login" })}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              ) : (
                <Link
                  href="/auth/login"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <LogOut className="h-4 w-4 rotate-180" />
                  Sign in
                </Link>
              )}
            </li>
          </ul>
        </nav>
      </aside>
    </>
  );
}
