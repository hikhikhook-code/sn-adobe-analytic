import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-lavender-100">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
