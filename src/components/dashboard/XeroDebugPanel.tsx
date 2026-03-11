import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, Globe, Users, Building2, Mail, Phone, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface XeroConnection {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc?: string;
  updatedDateUtc?: string;
}

interface XeroContact {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  ContactStatus?: string;
  IsSupplier?: boolean;
  IsCustomer?: boolean;
  Phones?: { PhoneType: string; PhoneNumber: string }[];
  Addresses?: { AddressType: string; City?: string; Region?: string; Country?: string }[];
}

export default function XeroDebugPanel() {
  const [connections, setConnections] = useState<XeroConnection[] | null>(null);
  const [contacts, setContacts] = useState<XeroContact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleFetch = async () => {
    setLoading(true);
    setConnections(null);
    setContacts(null);
    try {
      const { data, error } = await supabase.functions.invoke("xero-debug");
      if (error) throw error;
      setConnections(Array.isArray(data?.connections) ? data.connections : null);
      const rawContacts = data?.contacts?.Contacts;
      setContacts(Array.isArray(rawContacts) ? rawContacts : null);
    } catch (err: any) {
      toast({ title: "Debug Fetch Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const getPhone = (contact: XeroContact) => {
    const phone = contact.Phones?.find((p) => p.PhoneNumber);
    return phone?.PhoneNumber || null;
  };

  const getAddress = (contact: XeroContact) => {
    const addr = contact.Addresses?.find((a) => a.City || a.Region || a.Country);
    if (!addr) return null;
    return [addr.City, addr.Region, addr.Country].filter(Boolean).join(", ");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Xero API Explorer</CardTitle>
        <Button onClick={handleFetch} disabled={loading} variant="outline" size="sm" className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {loading ? "Fetching…" : "Fetch Data"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {!connections && !contacts && !loading && (
          <p className="text-sm text-muted-foreground">Click "Fetch Data" to load connected organisations and contacts from Xero.</p>
        )}

        {/* Connections */}
        {connections && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Connected Organisations</h3>
              <Badge variant="secondary" className="text-xs">{connections.length}</Badge>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Tenant ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.tenantName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{c.tenantType}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.tenantId}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Contacts */}
        {contacts && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Contacts</h3>
              <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
            </div>
            <ScrollArea className="h-[420px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((c) => (
                    <TableRow key={c.ContactID}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium">{c.Name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.EmailAddress ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            {c.EmailAddress}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {getPhone(c) ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0" />
                            {getPhone(c)}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {getAddress(c) ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {getAddress(c)}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={c.ContactStatus === "ACTIVE" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {c.ContactStatus ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {c.IsCustomer && <Badge variant="outline" className="text-xs">Customer</Badge>}
                          {c.IsSupplier && <Badge variant="outline" className="text-xs">Supplier</Badge>}
                          {!c.IsCustomer && !c.IsSupplier && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
