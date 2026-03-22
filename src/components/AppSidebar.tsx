import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useLocation } from "react-router-dom";

const navItems = [
  { to: "/", label: "Home", icon: Home, requiresStructure: false },
  { to: "/structures", label: "Structures", icon: Network, requiresStructure: false },
  { to: "/governance", label: "Health Check", icon: HeartPulse, requiresStructure: true },
  { to: "/review", label: "Review & Improve", icon: Sparkles, requiresStructure: true },
  { to: "/import", label: "Import", icon: Upload, requiresStructure: false },
  { to: "/settings", label: "Settings", icon: Settings, requiresStructure: false },
];

export default function AppSidebar() {
  const { signOut, user } = useAuth();
  const { tenant } = useTenantSettings();
  const location = useLocation();

  const firmName = tenant?.firm_name || tenant?.name;
  const logoUrl = tenant?.logo_url;

  // Check if a structure is currently selected (i.e. on a /structures/:id route)
  const isStructureSelected = /^\/structures\/[^/]+/.test(location.pathname);

  return (
    <aside className="flex h-screen w-[220px] flex-col border-r border-border/50 bg-card/50">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5">
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
        <span className="truncate text-sm font-semibold text-foreground">
          {firmName ?? "strukcha"}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3 pt-2">
        {navItems.map((item) => {
          const disabled = item.requiresStructure && !isStructureSelected;

          if (disabled) {
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <div
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground/50 cursor-not-allowed select-none"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  Select a structure to use this feature.
                </TooltipContent>
              </Tooltip>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              activeClassName="bg-accent text-foreground font-semibold"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/50 px-4 py-3.5 space-y-1.5">
        <p className="truncate text-[11px] text-muted-foreground/60">
          {user?.email}
        </p>
        <FeedbackModal />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={signOut}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
