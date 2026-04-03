import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Network,
  Building2,
  Users,
  Shield,
  Briefcase,
  Settings,
  HeartPulse,
  Sparkles,
  Upload,
  Home,
  Search,
} from "lucide-react";

interface SearchResult {
  id: string;
  label: string;
  type: "structure" | "entity" | "group" | "page";
  icon: React.ReactNode;
  path: string;
  subtitle?: string;
}

const PAGES: SearchResult[] = [
  { id: "page-dashboard", label: "Dashboard", type: "page", icon: <Home className="h-4 w-4" />, path: "/" },
  { id: "page-import", label: "Import", type: "page", icon: <Upload className="h-4 w-4" />, path: "/import" },
  { id: "page-structures", label: "Structures", type: "page", icon: <Network className="h-4 w-4" />, path: "/structures" },
  { id: "page-health", label: "Health Check", type: "page", icon: <HeartPulse className="h-4 w-4" />, path: "/governance" },
  { id: "page-review", label: "Review & Improve", type: "page", icon: <Sparkles className="h-4 w-4" />, path: "/review" },
  { id: "page-settings", label: "Settings", type: "page", icon: <Settings className="h-4 w-4" />, path: "/settings" },
];

function getEntityIcon(type: string) {
  if (type === "Company") return <Building2 className="h-4 w-4 text-primary/70" />;
  if (type === "Individual") return <Users className="h-4 w-4 text-primary/70" />;
  if (type.startsWith("trust") || type === "Trust" || type === "smsf") return <Shield className="h-4 w-4 text-primary/70" />;
  if (type === "Partnership" || type === "Sole Trader") return <Briefcase className="h-4 w-4 text-primary/70" />;
  return <Building2 className="h-4 w-4 text-muted-foreground/50" />;
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [structures, setStructures] = useState<SearchResult[]>([]);
  const [entities, setEntities] = useState<SearchResult[]>([]);
  const [groups, setGroups] = useState<SearchResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Load data when dialog opens
  useEffect(() => {
    if (!open || loaded || !session?.user) return;

    async function load() {
      const [structRes, entityRes, groupRes] = await Promise.all([
        supabase
          .from("structures")
          .select("id, name, source")
          .is("deleted_at", null)
          .eq("is_scenario", false)
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("entities")
          .select("id, name, entity_type")
          .is("deleted_at", null)
          .order("name")
          .limit(500),
        supabase
          .from("xpm_groups")
          .select("xpm_uuid, name")
          .order("name")
          .limit(200),
      ]);

      setStructures(
        (structRes.data ?? []).map((s: any) => ({
          id: s.id,
          label: s.name,
          type: "structure",
          icon: s.source === "manual" ? <Network className="h-4 w-4 text-primary/70" /> : <Network className="h-4 w-4 text-primary/70" />,
          path: `/structures/${s.id}`,
          subtitle: s.source === "manual" ? "Manual" : "XPM",
        }))
      );

      setEntities(
        (entityRes.data ?? []).map((e: any) => ({
          id: e.id,
          label: e.name,
          type: "entity",
          icon: getEntityIcon(e.entity_type),
          path: `/structures?entity=${e.id}`,
          subtitle: e.entity_type,
        }))
      );

      setGroups(
        (groupRes.data ?? []).map((g: any) => ({
          id: g.xpm_uuid,
          label: g.name,
          type: "group",
          icon: <Network className="h-4 w-4 text-muted-foreground" />,
          path: `/structures?group=${g.xpm_uuid}`,
          subtitle: "Client Group",
        }))
      );

      setLoaded(true);
    }

    load();
  }, [open, loaded, session?.user]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setOpen(false);
      setQuery("");
      navigate(result.path);
    },
    [navigate],
  );

  const q = query.toLowerCase().trim();

  const filteredPages = PAGES.filter((p) => p.label.toLowerCase().includes(q));
  const filteredStructures = q ? structures.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 8) : structures.slice(0, 5);
  const filteredEntities = q ? entities.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 8) : [];
  const filteredGroups = q ? groups.filter((g) => g.label.toLowerCase().includes(q)).slice(0, 8) : groups.slice(0, 3);

  return (
    <>
      {/* Trigger button for header */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="ml-2 rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search structures, entities, groups, pages…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {filteredPages.length > 0 && (
            <CommandGroup heading="Pages">
              {filteredPages.map((p) => (
                <CommandItem key={p.id} onSelect={() => handleSelect(p)} className="gap-2.5">
                  {p.icon}
                  <span>{p.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredStructures.length > 0 && (
            <CommandGroup heading="Structures">
              {filteredStructures.map((s) => (
                <CommandItem key={s.id} onSelect={() => handleSelect(s)} className="gap-2.5">
                  {s.icon}
                  <span className="flex-1 truncate">{s.label}</span>
                  {s.subtitle && (
                    <span className="text-[10px] text-muted-foreground">{s.subtitle}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredEntities.length > 0 && (
            <CommandGroup heading="Entities">
              {filteredEntities.map((e) => (
                <CommandItem key={e.id} onSelect={() => handleSelect(e)} className="gap-2.5">
                  {e.icon}
                  <span className="flex-1 truncate">{e.label}</span>
                  {e.subtitle && (
                    <span className="text-[10px] text-muted-foreground">{e.subtitle}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredGroups.length > 0 && (
            <CommandGroup heading="Client Groups">
              {filteredGroups.map((g) => (
                <CommandItem key={g.id} onSelect={() => handleSelect(g)} className="gap-2.5">
                  {g.icon}
                  <span className="flex-1 truncate">{g.label}</span>
                  {g.subtitle && (
                    <span className="text-[10px] text-muted-foreground">{g.subtitle}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
