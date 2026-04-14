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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Building2, Upload, Trash2, Loader2, Palette, FileText, Save, ChevronDown, X } from "lucide-react";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useSharedTenantSettings } from "@/contexts/TenantSettingsContext";

interface Props {
  isAdmin?: boolean;
}

export default function TenantSettings({ isAdmin = false }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentUser } = useTenantUsers();
  const { reload: reloadTenant } = useSharedTenantSettings();
  const isOwner = currentUser?.role === "owner";
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Form state
  const [firmName, setFirmName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState("#0F172A");
  const [exportFooter, setExportFooter] = useState("");
  const [exportDisclaimer, setExportDisclaimer] = useState("");
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [blockOnCritical, setBlockOnCritical] = useState(false);
  const [defaultViewMode, setDefaultViewMode] = useState("full");
  const [allowAdminIntegrations, setAllowAdminIntegrations] = useState(false);

  // Track initial state for dirty detection
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const currentState = {
    firmName, brandColor, exportFooter, exportDisclaimer, showDisclaimer,
    blockOnCritical, defaultViewMode, allowAdminIntegrations,
  };
  const isDirty = JSON.stringify(currentState) !== JSON.stringify(initial);

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
        const fn = tenant.firm_name ?? tenant.name;
        const bc = tenant.brand_primary_color ?? "#0F172A";
        const ef = tenant.export_footer_text ?? "";
        const ed = tenant.export_disclaimer_text ?? "";
        const sd = tenant.export_show_disclaimer ?? false;
        const boc = tenant.export_block_on_critical_health ?? false;
        const dvm = tenant.export_default_view_mode ?? "full";
        const aai = (tenant as any).allow_admin_integrations ?? false;

        setFirmName(fn);
        setLogoUrl(tenant.logo_url ?? null);
        setBrandColor(bc);
        setExportFooter(ef);
        setExportDisclaimer(ed);
        setShowDisclaimer(sd);
        setBlockOnCritical(boc);
        setDefaultViewMode(dvm);
        setAllowAdminIntegrations(aai);

        setInitial({
          firmName: fn, brandColor: bc, exportFooter: ef, exportDisclaimer: ed,
          showDisclaimer: sd, blockOnCritical: boc, defaultViewMode: dvm,
          allowAdminIntegrations: aai,
        });
      }
      setLoading(false);
    }
    load();
  }, [user?.id]);

  const handleSave = useCallback(async () => {
    if (!tenantId) return;
    setSaving(true);
    const updatePayload: Record<string, unknown> = {
      firm_name: firmName,
      brand_primary_color: brandColor || null,
      export_footer_text: exportFooter || null,
      export_disclaimer_text: exportDisclaimer || null,
      export_show_disclaimer: showDisclaimer,
      export_block_on_critical_health: blockOnCritical,
      export_default_view_mode: defaultViewMode,
    };
    if (isOwner) {
      updatePayload.allow_admin_integrations = allowAdminIntegrations;
    }
    const { error } = await supabase
      .from("tenants")
      .update(updatePayload as any)
      .eq("id", tenantId);

    if (error) {
      console.error("Save failed:", error);
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Settings saved" });
      setInitial({ ...currentState });
      reloadTenant();
    }
    setSaving(false);
  }, [tenantId, firmName, brandColor, exportFooter, exportDisclaimer, showDisclaimer, blockOnCritical, defaultViewMode, allowAdminIntegrations, isOwner, toast]);

  const handleDiscard = () => {
    setFirmName(initial.firmName as string);
    setBrandColor(initial.brandColor as string);
    setExportFooter(initial.exportFooter as string);
    setExportDisclaimer(initial.exportDisclaimer as string);
    setShowDisclaimer(initial.showDisclaimer as boolean);
    setBlockOnCritical(initial.blockOnCritical as boolean);
    setDefaultViewMode(initial.defaultViewMode as string);
    setAllowAdminIntegrations(initial.allowAdminIntegrations as boolean);
  };

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
    const { error: updateError } = await supabase.from("tenants").update({ logo_url: publicUrl }).eq("id", tenantId);
    if (updateError) {
      toast({ title: "Save failed", description: updateError.message, variant: "destructive" });
    } else {
      setLogoUrl(publicUrl);
      toast({ title: "Logo uploaded" });
      reloadTenant();
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
    await supabase.from("tenants").update({ logo_url: null }).eq("id", tenantId);
    setLogoUrl(null);
    toast({ title: "Logo removed" });
    reloadTenant();
    setUploading(false);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h2 className="text-lg font-semibold">Firm Settings</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Manage your firm details, branding, and export defaults." : "View your firm details."}
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
            <Label className="text-sm">Firm ID</Label>
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
            <div className="flex items-center gap-3">
              <label className="relative h-10 w-12 cursor-pointer rounded-md border border-input overflow-hidden shrink-0">
                <span
                  className="absolute inset-0"
                  style={{ backgroundColor: brandColor }}
                />
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="w-28 font-mono text-xs"
                placeholder="#0F172A"
              />
            </div>
            <p className="text-xs text-muted-foreground">Used as accent colour in exported PDFs and reports.</p>
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

            {/* Advanced section */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors pt-2">
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                Advanced
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Block Exports on Critical Health</Label>
                    <p className="text-xs text-muted-foreground">Prevent exports when structure health is Critical.</p>
                  </div>
                  <Switch checked={blockOnCritical} onCheckedChange={setBlockOnCritical} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      {/* Sticky save bar */}
      {isAdmin && isDirty && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-6 py-3">
          <div className="mx-auto flex max-w-lg items-center justify-between">
            <button
              onClick={handleDiscard}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Discard changes
            </button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
