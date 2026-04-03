import { Outlet } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";
import GlobalSearch from "@/components/GlobalSearch";

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="flex items-center justify-end px-6 py-2 border-b border-border/40 bg-card/30 shrink-0">
          <GlobalSearch />
        </header>
        <main className="flex-1 overflow-auto px-6 pt-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
