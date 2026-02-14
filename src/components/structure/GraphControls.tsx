import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";

const RELATIONSHIP_TYPES = [
  "director",
  "shareholder",
  "beneficiary",
  "trustee",
  "appointer",
  "settlor",
  "partner",
  "spouse",
  "parent",
  "child",
];

interface GraphControlsProps {
  search: string;
  onSearchChange: (v: string) => void;
  filterRelType: string;
  onFilterRelTypeChange: (v: string) => void;
  showFamily: boolean;
  onShowFamilyChange: (v: boolean) => void;
  depth: number;
  onDepthChange: (v: number) => void;
  hasSelection: boolean;
}

export default function GraphControls({
  search,
  onSearchChange,
  filterRelType,
  onFilterRelTypeChange,
  showFamily,
  onShowFamilyChange,
  depth,
  onDepthChange,
  hasSelection,
}: GraphControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
      {/* Search */}
      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search entities..."
          className="pl-9 h-9"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Relationship filter */}
      <Select value={filterRelType} onValueChange={onFilterRelTypeChange}>
        <SelectTrigger className="w-[180px] h-9">
          <SelectValue placeholder="All relationships" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All relationships</SelectItem>
          {RELATIONSHIP_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Family toggle */}
      <div className="flex items-center gap-2">
        <Switch id="show-family" checked={showFamily} onCheckedChange={onShowFamilyChange} />
        <Label htmlFor="show-family" className="text-sm whitespace-nowrap">
          Family
        </Label>
      </div>

      {/* Depth slider */}
      <div className="flex items-center gap-2 min-w-[160px]">
        <Label className="text-sm whitespace-nowrap">
          Depth: {hasSelection ? depth : "–"}
        </Label>
        <Slider
          min={1}
          max={3}
          step={1}
          value={[depth]}
          onValueChange={([v]) => onDepthChange(v)}
          disabled={!hasSelection}
          className="w-20"
        />
      </div>
    </div>
  );
}
