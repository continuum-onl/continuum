import { Toaster as Sonner, toast } from "sonner";
import { BellIcon, CheckCircleIcon, ExclamationCircleIcon, ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { NOTIFICATION_DURATION } from "@/lib/notifications";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      {...props}
      className="continuum-notifications"
      position="bottom-right"
      duration={NOTIFICATION_DURATION}
      visibleToasts={3}
      gap={12}
      closeButton
      swipeDirections={["left", "right"]}
      offset={{ bottom: "calc(96px + env(safe-area-inset-bottom))", right: "24px" }}
      mobileOffset={{ bottom: "calc(96px + env(safe-area-inset-bottom))", right: "16px" }}
      icons={{ success: <CheckCircleIcon />, error: <ExclamationCircleIcon />, info: <BellIcon />, warning: <ExclamationTriangleIcon />, close: <XMarkIcon /> }}
      toastOptions={{
        duration: NOTIFICATION_DURATION,
        classNames: {
          toast: "continuum-notification",
          title: "notification-title",
          description: "notification-description",
          icon: "notification-icon",
          closeButton: "notification-close",
          actionButton: "notification-action",
          cancelButton: "notification-action",
        },
      }}
    />
  );
};

export { Toaster, toast };
