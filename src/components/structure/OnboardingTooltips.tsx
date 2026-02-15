import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  onDismiss: () => void;
}

const STEPS = [
  {
    title: "View Modes",
    description:
      "Use the Ownership / Control / Full dropdown to focus on different relationship types. Ownership shows shareholdings and memberships; Control shows directors and trustees.",
  },
  {
    title: "Layout & Fit",
    description:
      "Auto-layout rearranges all nodes using an algorithm. Fit View zooms the canvas to show all entities. Try different layout modes for different structure types.",
  },
  {
    title: "Review & Fix",
    description:
      'Entities marked "Unclassified" will block clean exports. Go to Review & Fix to classify them before exporting.',
  },
];

export default function OnboardingTooltips({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onDismiss();
    }
  };

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 w-[380px]">
      <Card className="p-4 shadow-lg border-primary/20">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm">{current.title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {current.description}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] text-muted-foreground">
            {step + 1} / {STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {step > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs" onClick={handleNext}>
              {step < STEPS.length - 1 ? "Next" : "Got it"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
