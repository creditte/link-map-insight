import { useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { MessageSquarePlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function FeedbackModal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const params = useParams();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const structureId = params.id && location.pathname.startsWith("/structures/") ? params.id : null;

  const handleSubmit = async () => {
    if (!message.trim() || !user?.id) return;
    setSubmitting(true);

    try {
      // Get tenant_id
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user.id)
        .single();

      if (!profile) throw new Error("Profile not found");

      const { error } = await supabase.from("feedback").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        page: location.pathname,
        structure_id: structureId,
        message: message.trim(),
        metadata: {
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        },
      });

      if (error) throw error;

      toast({ title: "Feedback sent", description: "Thank you for your feedback!" });
      setMessage("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to send feedback", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-sidebar-foreground/70"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="h-4 w-4" />
        Send Feedback
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Share your thoughts, report issues, or suggest improvements.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="What's on your mind?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Page: {location.pathname}
              {structureId && ` · Structure: ${structureId.slice(0, 8)}…`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !message.trim()}>
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Sending…</>
              ) : (
                "Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
