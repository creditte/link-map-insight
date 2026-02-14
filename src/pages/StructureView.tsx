import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Network } from "lucide-react";

export default function StructureView() {
  const { id } = useParams();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Structure View</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5 text-muted-foreground" />
            React Flow Graph — Coming Next
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The interactive graph visualisation with entity nodes, relationship edges, and filtering controls will be built here. Structure ID: {id}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
