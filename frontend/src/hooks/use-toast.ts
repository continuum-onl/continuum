import * as React from "react";
import { toast as sonnerToast } from "sonner";
import { notificationContent, NOTIFICATION_DURATION, shouldDisplayNotification, type NotificationCategory } from "@/lib/notifications";

import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | {
      type: ActionType["ADD_TOAST"];
      toast: ToasterToast;
    }
  | {
      type: ActionType["UPDATE_TOAST"];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType["DISMISS_TOAST"];
      toastId?: ToasterToast["id"];
    }
  | {
      type: ActionType["REMOVE_TOAST"];
      toastId?: ToasterToast["id"];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, "id" | "variant"> & {
  variant?: ToastProps["variant"] | "info" | "warning";
  notificationCategory?: NotificationCategory;
};

function toast({ notificationCategory, ...props }: Toast) {
  const id = genId();
  const kind = props.variant === "destructive"
    ? "error"
    : props.variant === "info"
      ? "info"
      : props.variant === "warning"
        ? "warning"
        : "success";
  if (!shouldDisplayNotification(kind, notificationCategory)) {
    return { id, dismiss: () => {}, update: () => {} };
  }

  const content = notificationContent(kind, props.title, props.description);
  const sonnerOptions = {
    id,
    description: content.description,
    action: props.action,
    duration: NOTIFICATION_DURATION,
  };
  sonnerToast[kind](content.title, sonnerOptions);

  const update = (nextToast: ToasterToast) => {
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...nextToast, id },
    });
    const nextKind = nextToast.variant === "destructive" ? "error" : kind;
    const nextContent = notificationContent(nextKind, nextToast.title, nextToast.description);
    sonnerToast[nextKind](nextContent.title, {
      id,
      description: nextContent.description,
      action: nextToast.action,
      duration: NOTIFICATION_DURATION,
    });
  };
  const dismiss = () => {
    dispatch({ type: "DISMISS_TOAST", toastId: id });
    sonnerToast.dismiss(id);
  };

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      variant: props.variant === "info" || props.variant === "warning" ? "default" : props.variant,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return {
    id: id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => {
      dispatch({ type: "DISMISS_TOAST", toastId });
      sonnerToast.dismiss(toastId);
    },
  };
}

export { useToast, toast };
