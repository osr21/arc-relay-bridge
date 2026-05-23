import { BridgeStep, ActiveStep } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { Check, Loader2, X } from "lucide-react";

interface StepDef {
  key: ActiveStep;
  label: string;
  feeOnly?: boolean;
}

const ALL_STEPS: StepDef[] = [
  { key: "approving",  label: "Approve" },
  { key: "collecting", label: "Fee",    feeOnly: true },
  { key: "burning",    label: "Burn"   },
  { key: "attesting",  label: "Attest" },
  { key: "minting",    label: "Mint"   },
];

const STEP_ORDER: ActiveStep[] = ["approving", "collecting", "burning", "attesting", "minting"];

function getStepState(
  stepKey: ActiveStep,
  currentStep: BridgeStep,
  failedAtStep?: ActiveStep
): "done" | "active" | "pending" | "error" {
  const stepIdx = STEP_ORDER.indexOf(stepKey);

  if (currentStep === "done") return "done";

  if (currentStep === "error") {
    const failedIdx = failedAtStep ? STEP_ORDER.indexOf(failedAtStep) : -1;
    if (failedIdx === -1) return "pending";
    if (stepIdx < failedIdx) return "done";
    if (stepIdx === failedIdx) return "error";
    return "pending";
  }

  const currentIdx = STEP_ORDER.indexOf(currentStep as ActiveStep);
  if (currentIdx === -1) return "pending";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

interface StepProgressProps {
  step: BridgeStep;
  failedAtStep?: ActiveStep;
  hasFee: boolean;
}

export function StepProgress({ step, failedAtStep, hasFee }: StepProgressProps) {
  if (step === "idle") return null;

  const visibleSteps = ALL_STEPS.filter((s) => !s.feeOnly || hasFee);

  return (
    <div className="flex items-center gap-1 w-full">
      {visibleSteps.map((s, idx) => {
        const state = getStepState(s.key, step, failedAtStep);
        return (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                  state === "done"    && "bg-emerald-500 text-white",
                  state === "active"  && "bg-[#4F9CF9] text-white ring-2 ring-[#4F9CF9]/40",
                  state === "pending" && "bg-slate-700 text-slate-500",
                  state === "error"   && "bg-red-500 text-white"
                )}
              >
                {state === "done"   ? <Check   className="w-4 h-4" /> :
                 state === "active" ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 state === "error"  ? <X       className="w-4 h-4" /> :
                 idx + 1}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  state === "done"    && "text-emerald-400",
                  state === "active"  && "text-[#4F9CF9]",
                  state === "pending" && "text-slate-600",
                  state === "error"   && "text-red-400"
                )}
              >
                {s.label}
              </span>
            </div>
            {idx < visibleSteps.length - 1 && (
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
