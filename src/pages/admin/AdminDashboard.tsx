import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Users, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

interface TenantRow {
  id: string;
  name: string;
  firm_name: string;
  created_at: string;
  user_count: number;
}

export default function AdminDashboard() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFirmName, setNewFirmName] = useState("");
  const { toast } = useToast();

  const fetchTenants = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_list_all_tenants");
    if (error) {
      toast({ title: "Error loading tenants", description: error.message, variant: "destructive" });
    } else {
      setTenants((data as unknown as TenantRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTenants(); }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !newFirmName.trim()) return;
    setCreating(true);
    const { error } = await supabase.rpc("rpc_create_tenant", {
      p_name: newName.trim(),
      p_firm_name: newFirmName.trim(),
    });
    if (error) {
      toast({ title: "Error creating tenant", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tenant created" });
      setDialogOpen(false);
      setNewName("");
      setNewFirmName("");
      fetchTenants();
    }
    setCreating(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">Super Admin Portal</h1>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> New Tenant
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Tenant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Internal Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. acme-corp" />
              </div>
              <div className="space-y-2">
                <Label>Firm Display Name</Label>
                <Input value={newFirmName} onChange={(e) => setNewFirmName(e.target.value)} placeholder="e.g. ACME Corporation" />
              </div>
              <Button onClick={handleCreate} disabled={creating || !newName.trim() || !newFirmName.trim()} className="w-full">
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Tenant
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-4">
        <h2 className="text-lg font-semibold">All Tenants ({tenants.length})</h2>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tenants…
          </div>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">No tenants yet. Create one to get started.</p>
        ) : (
          <div className="grid gap-3">
            {tenants.map((t) => (
              <Link key={t.id} to={`/admin/tenants/${t.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{t.firm_name || t.name}</span>
                      <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> {t.user_count}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground">
                      ID: {t.id} · Created: {new Date(t.created_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
