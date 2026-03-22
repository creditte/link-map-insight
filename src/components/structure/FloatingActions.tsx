import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  onAddEntity: () => void;
  onAiAssist: () => void;
  showAiPanel: boolean;
  disabled?: boolean;
}

export default function FloatingActions({ onAddEntity, onAiAssist, showAiPanel, disabled }: Props) {
  return (
    <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="lg"
            className="h-12 w-12 rounded-full shadow-lg"
            onClick={onAddEntity}
            disabled={disabled}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Add Entity</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={showAiPanel ? "secondary" : "outline"}
            size="icon"
            className="h-10 w-10 rounded-full shadow-md bg-background"
            onClick={onAiAssist}
            disabled={disabled}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">AI Assist</TooltipContent>
      </Tooltip>
    </div>
  );
}
