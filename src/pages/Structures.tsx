import { useState } from "react";
import XpmGroupCards from "@/components/structure/XpmGroupCards";
import GroupStructureViewer from "@/components/structure/GroupStructureViewer";

export default function Structures() {
  const [selectedGroup, setSelectedGroup] = useState<{ xpm_uuid: string; name: string } | null>(null);

  if (selectedGroup) {
    return (
      <div className="flex h-[calc(100vh-4rem)] -m-6">
        <div className="w-[300px] border-r overflow-y-auto p-4 space-y-3 bg-card">
          <XpmGroupCards
            onSelectGroup={(g) => setSelectedGroup({ xpm_uuid: g.xpm_uuid, name: g.name })}
            selectedGroupId={selectedGroup.xpm_uuid}
          />
        </div>
        <div className="flex-1">
          <GroupStructureViewer
            groupUuid={selectedGroup.xpm_uuid}
            groupName={selectedGroup.name}
            onClose={() => setSelectedGroup(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Structures</h1>
      <p className="text-sm text-muted-foreground">
        Connect with XPM Practice Manager to view your client groups and their structures.
      </p>
      <XpmGroupCards
        onSelectGroup={(g) => setSelectedGroup({ xpm_uuid: g.xpm_uuid, name: g.name })}
        selectedGroupId={null}
      />
    </div>
  );
}
