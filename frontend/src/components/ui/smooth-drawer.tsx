/**
 * Smooth Drawer — the single bottom-sheet used across the app.
 * Based on KokonutUI Smooth Drawer (MIT, @dorianbaffier), adapted to the
 * app's tokens, framer-motion and controlled usage.
 */
import type * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const containerVariants = {
  hidden: { y: 24, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 300, damping: 30, mass: 0.8, staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

export const smoothDrawerItem = {
  hidden: { y: 16, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 } },
};

interface SmoothDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Hide the visual header (title stays available to screen readers). */
  hideHeader?: boolean;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /**
   * vaul resizes/offsets the drawer when the mobile keyboard opens. Pass `false`
   * to let the browser handle it — avoids the drawer getting stuck displaced
   * after the keyboard is dismissed.
   */
  repositionInputs?: boolean;
}

export default function SmoothDrawer({
  open,
  onOpenChange,
  title,
  description,
  hideHeader = false,
  children,
  className,
  bodyClassName,
  repositionInputs = true,
}: SmoothDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={false}
      repositionInputs={repositionInputs}
    >
      <DrawerContent
        className={cn(
          "mx-auto max-h-[88dvh] w-full max-w-lg rounded-t-3xl border-border/10 bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-xl sm:bottom-4 sm:rounded-3xl",
          className,
        )}
      >
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants as never}
          className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain", bodyClassName)}
        >
          <motion.div variants={smoothDrawerItem as never} className={hideHeader ? "sr-only" : undefined}>
            <DrawerHeader className="space-y-1.5 px-5 pb-2 pt-4 text-center">
              <DrawerTitle className="font-serif text-2xl tracking-tight">{title ?? ""}</DrawerTitle>
              {description && (
                <DrawerDescription className="text-sm leading-relaxed text-muted-foreground">{description}</DrawerDescription>
              )}
            </DrawerHeader>
          </motion.div>
          <motion.div variants={smoothDrawerItem as never} className="min-h-0 flex-1">
            {children}
          </motion.div>
        </motion.div>
      </DrawerContent>
    </Drawer>
  );
}
