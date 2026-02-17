import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, FileText, DollarSign, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useBilletPayment } from "@/hooks/useBilletPayment";
import { parseBoleto } from "@/utils/boletoParser";

interface BoletoPaymentDrawerProps {
  open: boolean;
  barcode: string;
  onOpenChange: (open: boolean) => void;
}

export function BoletoPaymentDrawer({ open, barcode, onOpenChange }: BoletoPaymentDrawerProps) {
  const navigate = useNavigate();
  const { payBillet, isProcessing } = useBilletPayment();
  const [step, setStep] = useState<1 | 2>(1);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !barcode) return;
    setDescription("");

    const info = parseBoleto(barcode);
    if (info && info.amount > 0) {
      setAmount(info.amount.toFixed(2).replace(".", ","));
      setDueDate(info.dueDate);
      setStep(2);
    } else {
      setAmount("");
      setDueDate(null);
      setStep(1);
    }
  }, [open, barcode]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleBack = () => {
    if (step === 1) {
      handleClose();
    } else {
      setStep(1);
    }
  };

  const handleStep1 = () => {
    const value = parseFloat(amount.replace(",", "."));
    if (!value || value <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setStep(2);
  };

  const handleConfirm = async () => {
    const value = parseFloat(amount.replace(",", "."));
    const result = await payBillet({
      digitable_code: barcode,
      description: description || "Pagamento de boleto",
      amount: value,
    });

    if (result) {
      handleClose();
      navigate("/transactions");
    }
  };

  const formattedAmount = () => {
    const value = parseFloat(amount.replace(",", "."));
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const formattedDueDate = () => {
    if (!dueDate) return null;
    const [y, m, d] = dueDate.split("-");
    return `${d}/${m}/${y}`;
  };

  const stepIcon = step === 1 ? DollarSign : CheckCircle2;
  const stepTitle = step === 1 ? "Valor do Boleto" : "Confirmar Pagamento";
  const StepIcon = stepIcon;

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          <DrawerHeader className="flex-row items-center gap-3 p-0 pb-5">
            <button onClick={handleBack} className="p-1 -ml-1">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <StepIcon className="h-4 w-4 text-primary-foreground" />
              </div>
              <DrawerTitle className="text-base font-bold uppercase tracking-wide">
                {stepTitle}
              </DrawerTitle>
            </div>
          </DrawerHeader>
          <DrawerDescription className="sr-only">
            {stepTitle}
          </DrawerDescription>

          {/* Step indicators */}
          <div className="flex gap-1.5 mb-5">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Step 1: Amount */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Código</p>
                <p className="text-xs font-mono break-all text-foreground/80">{barcode}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="boleto-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="boleto-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-14 text-2xl font-bold text-center"
                  autoFocus
                />
              </div>

              <Button
                onClick={handleStep1}
                disabled={!amount || parseFloat(amount.replace(",", ".")) <= 0}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Confirmation */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipo</span>
                  <span className="text-sm font-medium">Boleto</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Código</span>
                  <span className="text-xs font-mono truncate ml-2 max-w-[60%] text-right">{barcode}</span>
                </div>
                <div className="h-px bg-border" />
                {formattedDueDate() && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Vencimento</span>
                      <span className="text-sm font-medium">{formattedDueDate()}</span>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valor</span>
                  <span className="text-lg font-bold text-primary">{formattedAmount()}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="boleto-desc" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição (opcional)
                </Label>
                <Input
                  id="boleto-desc"
                  type="text"
                  placeholder="Ex: Conta de luz"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <Button
                onClick={handleConfirm}
                disabled={isProcessing}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Processando...
                  </>
                ) : (
                  "Confirmar Pagamento"
                )}
              </Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
