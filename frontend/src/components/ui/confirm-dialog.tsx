import * as React from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  confirmationPhrase?: string;
  confirmationPrompt?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  destructive = false,
  confirmationPhrase,
  confirmationPrompt,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  const [typedConfirmation, setTypedConfirmation] = React.useState("");
  const confirmationInputId = React.useId();
  const resolvedConfirmText = confirmText ?? t("common_confirm");
  const resolvedCancelText = cancelText ?? t("common_cancel");
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setTypedConfirmation("");
    onOpenChange(nextOpen);
  };
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmationPhrase && (
          <div className="space-y-2">
            <label htmlFor={confirmationInputId} className="text-sm text-[hsl(var(--popup-muted))]">
              {confirmationPrompt}
            </label>
            <Input
              id={confirmationInputId}
              value={typedConfirmation}
              onChange={(event) => setTypedConfirmation(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="border-[hsl(var(--popup-border))] bg-transparent text-[hsl(var(--popup-muted))] hover:bg-white/[0.06] hover:text-white">{resolvedCancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={confirmationPhrase !== undefined && typedConfirmation !== confirmationPhrase}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-white text-black hover:bg-white/90"}
          >
            {resolvedConfirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
