import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Upload, Trash2, Loader2, Palette, FileText, Save } from "lucide-react";

interface Props {
  isAdmin?: boolean;
}

export default function TenantSettings({ isAdmin = false }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form state
  const [firmName, setFirmName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState("#0F172A");
  const [exportFooter, setExportFooter] = useState("");
  const [exportDisclaimer, setExportDisclaimer] = useState("");
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [blockOnCritical, setBlockOnCritical] = useState(false);
  const [defaultViewMode, setDefaultViewMode] = useState("full");

  useEffect(() => {
    if (!user?.id) return;
    async function load() {
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("user_id", user!.id).single();
      if (!profile) { setLoading(false); return; }

      const { data: tenant } = await supabase
        .from("tenants").select("*").eq("id", profile.tenant_id).single();

      if (tenant) {
        setTenantId(tenant.id);
        setFirmName((tenant as any).firm_name ?? tenant.name);
        setLogoUrl(tenant.logo_url ?? null);
        setBrandColor((tenant as any).brand_primary_color ?? "#0F172A");
        setExportFooter((tenant as any).export_footer_text ?? "");
        setExportDisclaimer((tenant as any).export_disclaimer_text ?? "");
        setShowDisclaimer((tenant as any).export_show_disclaimer ?? false);
        setBlockOnCritical((tenant as any).export_block_on_critical_health ?? false);
        setDefaultViewMode((tenant as any).export_default_view_mode ?? "full");
      }
      setLoading(false);
    }
    load();
  }, [user?.id]);

  const handleSave = useCallback(async () => {
    if (!tenantId) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        firm_name: firmName,
        brand_primary_color: brandColor || null,
        export_footer_text: exportFooter || null,
        export_disclaimer_text: exportDisclaimer || null,
        export_show_disclaimer: showDisclaimer,
        export_block_on_critical_health: blockOnCritical,
        export_default_view_mode: defaultViewMode,
      } as any)
      .eq("id", tenantId);

    if (error) {
      console.error("Save failed:", error);
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Settings saved" });
    }
    setSaving(false);
  }, [tenantId, firmName, brandColor, exportFooter, exportDisclaimer, showDisclaimer, blockOnCritical, defaultViewMode, toast]);

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
    const { error: uploadError } = await supabase.storage.from("tenant-assets").upload(path, file, { upsert: true });
    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("tenant-assets").getPublicUrl(path);
    const publicUrl = urlData.publicUrl;
    const { error: updateError } = await supabase.from("tenants").update({ logo_url: publicUrl } as any).eq("id", tenantId);
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
    const { data: files } = await supabase.storage.from("tenant-assets").list(`tenant/${tenantId}`);
    if (files?.length) {
      await supabase.storage.from("tenant-assets").remove(files.map((f) => `tenant/${tenantId}/${f.name}`));
    }
    await supabase.from("tenants").update({ logo_url: null } as any).eq("id", tenantId);
    setLogoUrl(null);
    toast({ title: "Logo removed" });
    setUploading(false);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Organisation</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Manage your firm details, branding, and export defaults." : "View your organisation details."}
        </p>
      </div>

      {/* Firm Identity */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Firm Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm">Firm Name</Label>
            <Input
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              className="mt-1"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <Label className="text-sm">Tenant ID</Label>
            <Input value={tenantId ?? ""} className="mt-1 font-mono text-xs" disabled />
          </div>
        </CardContent>
      </Card>

      {/* Logo */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5 text-muted-foreground" />
            Firm Logo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload your firm's logo. It will appear in the sidebar and exported PDFs, PNGs, and SVGs.
          </p>
          {logoUrl && (
            <div className="flex items-center gap-4 rounded-md border p-3 bg-muted/30">
              <img src={`${logoUrl}?t=${Date.now()}`} alt="Firm logo" className="max-h-12 max-w-[160px] object-contain" />
              {isAdmin && (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleLogoRemove} disabled={uploading}>
                  <Trash2 className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          )}
          {isAdmin && (
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Uploading…</> : <><Upload className="h-4 w-4 mr-1" /> {logoUrl ? "Replace Logo" : "Upload Logo"}</>}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG, or SVG · Max 2 MB</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Primary Color (admin only) */}
      {isAdmin && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-5 w-5 text-muted-foreground" />
              Primary Colour
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Used as subtle accent in exports (lines, borders).</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-input"
              />
              <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-28 font-mono text-xs" placeholder="#0F172A" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export Defaults (admin only) */}
      {isAdmin && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Export Defaults
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">Default View Mode</Label>
              <Select value={defaultViewMode} onValueChange={setDefaultViewMode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ownership">Ownership</SelectItem>
                  <SelectItem value="control">Control</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Footer Text</Label>
              <Input
                value={exportFooter}
                onChange={(e) => setExportFooter(e.target.value)}
                className="mt-1"
                placeholder={`Prepared by ${firmName || "your firm"}`}
              />
              <p className="text-xs text-muted-foreground mt-1">Appears at the bottom of exported PDFs.</p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm">Show Disclaimer</Label>
                <p className="text-xs text-muted-foreground">Include a disclaimer box on exports.</p>
              </div>
              <Switch checked={showDisclaimer} onCheckedChange={setShowDisclaimer} />
            </div>
            {showDisclaimer && (
              <div>
                <Label className="text-sm">Disclaimer Text</Label>
                <Textarea
                  value={exportDisclaimer}
                  onChange={(e) => setExportDisclaimer(e.target.value)}
                  className="mt-1"
                  rows={3}
                  placeholder="This document is for advisory purposes only..."
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm">Block Exports on Critical Health</Label>
                <p className="text-xs text-muted-foreground">Prevent exports when structure health is Critical.</p>
              </div>
              <Switch checked={blockOnCritical} onCheckedChange={setBlockOnCritical} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save */}
      {isAdmin && (
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      )}
    </div>
  );
}
