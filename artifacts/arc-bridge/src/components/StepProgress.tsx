import { BridgeStep } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { Check, Loader2, X } from "lucide-react";

const STEPS: { key: BridgeStep; label: string }[] = [
  { key: "approving", label: "Approve" },
  { key: "burning", label: "Burn" },
  { key: "attesting", label: "Attest" },
  { key: "minting", label: "Mint" },
  { key: "done", label: "Done" },
];

const STEP_ORDER = ["approving", "burning", "attesting", "minting", "done"];

function getStepState(stepKey: string, currentStep: BridgeStep): "done" | "active" | "pending" | "error" {
  if (currentStep === "error") {
    const currentIdx = STEP_ORDER.indexOf(currentStep);
    const stepIdx = STEP_ORDER.indexOf(stepKey);
    return stepIdx < currentIdx ? "done" : stepIdx === currentIdx ? "error" : "pending";
  }
  const currentIdx = STEP_ORDER.indexOf(currentStep);
  const stepIdx = STEP_ORDER.indexOf(stepKey);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

interface StepProgressProps {
  step: BridgeStep;
}

export function StepProgress({ step }: StepProgressProps) {
  if (step === "idle") return null;

  return (
    <div className="flex items-center gap-1 w-full">
      {STEPS.map((s, idx) => {
        const state = getStepState(s.key, step);
        return (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                  state === "done" && "bg-emerald-500 text-white",
                  state === "active" && "bg-[#4F9CF9] text-white ring-2 ring-[#4F9CF9]/40",
                  state === "pending" && "bg-slate-700 text-slate-500",
                  state === "error" && "bg-red-500 text-white"
                )}
              >
                {state === "done" ? (
                  <Check className="w-4 h-4" />
                ) : state === "active" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : state === "error" ? (
                  <X className="w-4 h-4" />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  state === "done" && "text-emerald-400",
                  state === "active" && "text-[#4F9CF9]",
                  state === "pending" && "text-slate-600",
                  state === "error" && "text-red-400"
                )}
              >
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mb-5 mx-1 transition-all duration-300",
                  state === "done" ? "bg-emerald-500" : "bg-slate-700"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
