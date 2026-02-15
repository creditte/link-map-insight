import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Building2, Loader2 } from "lucide-react";

export default function TenantSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    async function load() {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user!.id)
        .single();

      if (!profile) {
        setLoading(false);
        return;
      }

      const { data: tenant } = await supabase
        .from("tenants")
        .select("id, name")
        .eq("id", profile.tenant_id)
        .single();

      if (tenant) {
        setTenantId(tenant.id);
        setTenantName(tenant.name);
        setOriginalName(tenant.name);
      }
      setLoading(false);
    }

    load();
  }, [user?.id]);

  const handleSave = async () => {
    if (!tenantId || tenantName.trim() === originalName) return;
    setSaving(true);

    // Tenants table doesn't allow update from user RLS, so we'll note this
    // For now, show a toast with the limitation
    toast({
      title: "Tenant name",
      description:
        "Tenant configuration changes require admin backend access. Contact support to update.",
    });

    setSaving(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Organisation</h2>
        <p className="text-sm text-muted-foreground">
          View your organisation details.
        </p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Tenant Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm">Organisation Name</Label>
            <Input
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              className="mt-1"
              disabled
            />
          </div>
          <div>
            <Label className="text-sm">Tenant ID</Label>
            <Input value={tenantId ?? ""} className="mt-1 font-mono text-xs" disabled />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
