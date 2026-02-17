import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Key } from "lucide-react";
import { toast } from "sonner";

interface PixKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PixKeyDialog({ open, onOpenChange }: PixKeyDialogProps) {
  const navigate = useNavigate();
  const [pixKey, setPixKey] = useState("");
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const handleValidate = async () => {
    const trimmed = pixKey.trim();
    if (!trimmed) {
      toast.error("Informe a chave Pix");
      return;
    }

    setIsValidating(true);
    try {
      // Navigate to NewPayment with the key pre-filled
      onOpenChange(false);
      navigate(`/pix/new?tab=key&pixkey=${encodeURIComponent(trimmed)}`);
    } catch {
      toast.error("Erro ao validar chave Pix");
    } finally {
      setIsValidating(false);
    }
  };

  const handleClose = () => {
    setPixKey("");
    setSaveFavorite(false);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="rounded-t-2xl px-5 pb-8 pt-2">
        <SheetHeader className="flex-row items-center gap-3 space-y-0 pb-4">
          <button onClick={handleClose} className="p-1 -ml-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
              <Key className="h-4 w-4 text-primary-foreground" />
            </div>
            <SheetTitle className="text-base font-bold uppercase tracking-wide">
              Pix com Chave
            </SheetTitle>
          </div>
        </SheetHeader>
        <SheetDescription className="sr-only">
          Informe a chave Pix para realizar o pagamento
        </SheetDescription>

        <div className="space-y-5 mt-2">
          <div className="space-y-2">
            <Label htmlFor="pix-key" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Chave Pix
            </Label>
            <Input
              id="pix-key"
              placeholder="Ex: 123.456.789-10"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              className="h-12 text-base"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="save-favorite"
              checked={saveFavorite}
              onCheckedChange={(checked) => setSaveFavorite(checked === true)}
            />
            <Label htmlFor="save-favorite" className="text-sm font-medium cursor-pointer">
              Salvar como Favorecido
            </Label>
          </div>

          <Button
            onClick={handleValidate}
            disabled={isValidating || !pixKey.trim()}
            className="w-full h-12 text-base font-bold uppercase tracking-wider"
          >
            {isValidating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Validando...
              </>
            ) : (
              "Validar"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
