import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LayoutGrid, Compass, HelpCircle, ArrowRight } from "lucide-react";

const STEPS = [
  {
    icon: LayoutGrid,
    title: "Create your first structure",
    description: "Map out entities, relationships, and ownership in a visual workspace.",
  },
  {
    icon: Compass,
    title: "Explore the workspace",
    description: "Import data, run reviews, and manage your client structures.",
  },
  {
    icon: HelpCircle,
    title: "Get help or book a demo",
    description: "Reach out anytime at hello@strukcha.app — we're here to help.",
  },
];

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          Welcome to strukcha
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Your workspace is ready{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(" ")[0]}` : ""}.
        </p>

        <div className="mt-10 space-y-4 text-left">
          {STEPS.map((step, i) => (
            <Card key={i} className="border-border/50">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button
          className="mt-8 h-11 px-8 text-base font-semibold gap-2"
          onClick={() => navigate("/", { replace: true })}
        >
          Continue to Workspace
          <ArrowRight className="h-4 w-4" />
        </Button>

        <p className="mt-6 text-xs text-muted-foreground">
          Need help?{" "}
          <a href="mailto:hello@strukcha.app" className="hover:underline">hello@strukcha.app</a>
        </p>
      </div>
    </div>
  );
}
