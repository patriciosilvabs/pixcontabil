import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Keyboard } from "lucide-react";

interface ManualBarcodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (barcode: string) => void;
}

export function ManualBarcodeDialog({ open, onOpenChange, onSubmit }: ManualBarcodeDialogProps) {
  const [code, setCode] = useState("");

  const cleanCode = code.replace(/[\s.\-]/g, "");
  const isValid = /^\d{44,48}$/.test(cleanCode);

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit(cleanCode);
    setCode("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setCode(""); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Digitar Código do Boleto
          </DialogTitle>
          <DialogDescription>
            Digite ou cole a linha digitável ou código de barras do boleto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-barcode" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Linha Digitável / Código de Barras
            </Label>
            <Input
              id="manual-barcode"
              type="text"
              inputMode="numeric"
              placeholder="Digite os 44-48 dígitos do boleto"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono text-sm"
              autoFocus
            />
            {code.length > 0 && !isValid && (
              <p className="text-xs text-destructive">
                O código deve ter entre 44 e 48 dígitos numéricos.
              </p>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!isValid}
            className="w-full h-12 text-base font-bold uppercase tracking-wider"
          >
            Consultar Boleto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
