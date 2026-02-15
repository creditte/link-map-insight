import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Building2, Upload, Trash2, Loader2 } from "lucide-react";

export default function TenantSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

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
        .select("id, name, logo_url")
        .eq("id", profile.tenant_id)
        .single();

      if (tenant) {
        setTenantId(tenant.id);
        setTenantName(tenant.name);
        setOriginalName(tenant.name);
        setLogoUrl((tenant as any).logo_url ?? null);
      }
      setLoading(false);
    }

    load();
  }, [user?.id]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 2 MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop() ?? "png";
    const path = `tenant/${tenantId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("tenant-assets")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("tenant-assets").getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from("tenants")
      .update({ logo_url: publicUrl } as any)
      .eq("id", tenantId);

    if (updateError) {
      toast({ title: "Save failed", description: updateError.message, variant: "destructive" });
    } else {
      setLogoUrl(publicUrl);
      toast({ title: "Logo uploaded" });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleLogoRemove = async () => {
    if (!tenantId) return;
    setUploading(true);

    // List and remove files in tenant folder
    const { data: files } = await supabase.storage
      .from("tenant-assets")
      .list(`tenant/${tenantId}`);

    if (files?.length) {
      await supabase.storage
        .from("tenant-assets")
        .remove(files.map((f) => `tenant/${tenantId}/${f.name}`));
    }

    await supabase.from("tenants").update({ logo_url: null } as any).eq("id", tenantId);
    setLogoUrl(null);
    toast({ title: "Logo removed" });
    setUploading(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Organisation</h2>
        <p className="text-sm text-muted-foreground">
          View your organisation details and branding.
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
            <Input value={tenantName} className="mt-1" disabled />
          </div>
          <div>
            <Label className="text-sm">Tenant ID</Label>
            <Input value={tenantId ?? ""} className="mt-1 font-mono text-xs" disabled />
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5 text-muted-foreground" />
            Firm Logo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload your firm's logo. It will appear in exported PDFs, PNGs, and SVGs.
          </p>

          {logoUrl && (
            <div className="flex items-center gap-4 rounded-md border p-3 bg-muted/30">
              <img
                src={`${logoUrl}?t=${Date.now()}`}
                alt="Firm logo"
                className="max-h-12 max-w-[160px] object-contain"
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleLogoRemove}
                disabled={uploading}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Remove
              </Button>
            </div>
          )}

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-4 w-4 mr-1" /> {logoUrl ? "Replace Logo" : "Upload Logo"}</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-1">PNG, JPG, or SVG · Max 2 MB</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
