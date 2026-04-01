import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveDialog({ open, onOpenChange, children }: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

export function ResponsiveDialogContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { className?: string }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerContent className={className} {...(props as any)}>
        {children}
      </DrawerContent>
    );
  }

  return (
    <DialogContent className={className} {...(props as any)}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  return isMobile ? <DrawerHeader className={className} {...props} /> : <DialogHeader className={className} {...props} />;
}

export function ResponsiveDialogTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <DrawerTitle className={className} {...(props as any)}>{children}</DrawerTitle>
  ) : (
    <DialogTitle className={className} {...(props as any)}>{children}</DialogTitle>
  );
}

export function ResponsiveDialogDescription({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <DrawerDescription className={className} {...(props as any)}>{children}</DrawerDescription>
  ) : (
    <DialogDescription className={className} {...(props as any)}>{children}</DialogDescription>
  );
}

export function ResponsiveDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  return isMobile ? <DrawerFooter className={className} {...props} /> : <DialogFooter className={className} {...props} />;
}

export function ResponsiveDialogClose({ children, ...props }: React.ComponentPropsWithoutRef<typeof DialogClose>) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <DrawerClose {...(props as any)}>{children}</DrawerClose>
  ) : (
    <DialogClose {...props}>{children}</DialogClose>
  );
}
