import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { Button } from "@/components/ui/button";
import FeedbackModal from "@/components/FeedbackModal";
import {
  LayoutDashboard,
  Network,
  Upload,
  AlertTriangle,
  Settings,
  LogOut,
  ShieldCheck } from
"lucide-react";

const navItems = [
{ to: "/", label: "Dashboard", icon: LayoutDashboard },
{ to: "/structures", label: "Structures", icon: Network },
{ to: "/governance", label: "Governance", icon: ShieldCheck },
{ to: "/import", label: "Import", icon: Upload },
{ to: "/review", label: "Review & Fix", icon: AlertTriangle },
{ to: "/settings", label: "Settings", icon: Settings }];


export default function AppSidebar() {
  const { signOut, user } = useAuth();
  const { tenant } = useTenantSettings();

  const firmName = tenant?.firm_name || tenant?.name;
  const logoUrl = tenant?.logo_url;

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b px-4 gap-2">
        {logoUrl ?
        <img src={`${logoUrl}?t=1`} alt="Firm logo" className="h-7 max-w-[80px] object-contain" /> :
        null}
        <span className="truncate text-sm font-semibold">{firmName ?? "My Firm"}</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) =>
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
          
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        )}
      </nav>
      <div className="border-t p-3 space-y-1">
        <p className="mb-1 truncate text-xs text-sidebar-foreground/50">{user?.email}</p>
        <FeedbackModal />
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
        <p className="text-[10px] text-sidebar-foreground/30 text-center pt-1">Powered by strukcha</p>
      </div>
    </aside>);

}