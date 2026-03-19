import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { Button } from "@/components/ui/button";
import FeedbackModal from "@/components/FeedbackModal";
import {
  Home,
  Network,
  Upload,
  HeartPulse,
  Sparkles,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/structures", label: "Structures", icon: Network },
  { to: "/governance", label: "Health Check", icon: HeartPulse },
  { to: "/review", label: "Review & Improve", icon: Sparkles },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppSidebar() {
  const { signOut, user } = useAuth();
  const { tenant } = useTenantSettings();

  const firmName = tenant?.firm_name || tenant?.name;
  const logoUrl = tenant?.logo_url;

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo / Workspace */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-4 gap-2.5">
        {logoUrl ? (
          <img
            src={`${logoUrl}?t=1`}
            alt="Firm logo"
            className="h-6 max-w-[72px] object-contain"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Network className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
        )}
        <span className="truncate text-sm font-semibold text-sidebar-foreground">
          {firmName ?? "strukcha"}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-2 pt-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3 space-y-1">
        <p className="mb-1 truncate text-[11px] text-sidebar-foreground/40">
          {user?.email}
        </p>
        <FeedbackModal />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground/60 hover:text-sidebar-foreground"
          onClick={signOut}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
