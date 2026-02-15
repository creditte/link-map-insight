import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import FeedbackModal from "@/components/FeedbackModal";
import {
  LayoutDashboard,
  Network,
  Upload,
  AlertTriangle,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/structures", label: "Structures", icon: Network },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/review", label: "Review & Fix", icon: AlertTriangle },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppSidebar() {
  const { signOut, user } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b px-4">
        <h1 className="text-lg font-bold tracking-tight text-sidebar-primary">Strukcha</h1>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3 space-y-1">
        <p className="mb-1 truncate text-xs text-sidebar-foreground/50">{user?.email}</p>
        <FeedbackModal />
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
