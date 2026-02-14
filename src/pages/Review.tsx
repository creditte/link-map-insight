import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function Review() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Review & Fix</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            Coming in Phase 2
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This screen will show entities with Unclassified or Trust-Unknown types that need resolution, along with duplicate merge suggestions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
