import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, QrCode, DollarSign, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";

interface PixQrPaymentDrawerProps {
  open: boolean;
  qrCode: string;
  onOpenChange: (open: boolean) => void;
}

export function PixQrPaymentDrawer({ open, qrCode, onOpenChange }: PixQrPaymentDrawerProps) {
  const navigate = useNavigate();
  const { getQRCodeInfo, payByQRCode, isProcessing } = usePixPayment();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [merchantCity, setMerchantCity] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [hasFixedAmount, setHasFixedAmount] = useState(false);

  useEffect(() => {
    if (!open || !qrCode) return;
    setStep(1);
    setIsLoading(true);
    setAmount("");
    setMerchantName("");
    setMerchantCity("");
    setPixKey("");
    setHasFixedAmount(false);

    (async () => {
      const info = await getQRCodeInfo({ qr_code: qrCode });
      setIsLoading(false);
      if (info) {
        setMerchantName(info.merchant_name || "");
        setMerchantCity(info.merchant_city || "");
        setPixKey(info.pix_key || "");
        if (info.amount && info.amount > 0) {
          setAmount(info.amount.toFixed(2).replace(".", ","));
          setHasFixedAmount(true);
          // Skip amount step, go straight to confirmation
          setStep(3);
        } else {
          setStep(2);
        }
      } else {
        toast.error("Não foi possível ler os dados do QR Code");
        setStep(2);
      }
    })();
  }, [open, qrCode]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleBack = () => {
    if (step <= 2) {
      handleClose();
    } else {
      setStep((s) => (s - 1) as 1 | 2 | 3);
    }
  };

  const handleStep2 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    setStep(3);
  };

  const handleConfirm = async () => {
    const value = parseLocalizedNumber(amount);
    const result = await payByQRCode({
      qr_code: qrCode,
      valor: value,
    });

    if (result) {
      handleClose();
      navigate(`/transactions`);
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const stepIcon = step === 1 ? QrCode : step === 2 ? DollarSign : CheckCircle2;
  const stepTitle = step === 1 ? "Lendo QR Code" : step === 2 ? "Valor do Pagamento" : "Confirmar Pagamento";
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
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Step 1: Loading QR info */}
          {step === 1 && isLoading && (
            <div className="space-y-4 py-6">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Consultando dados do QR Code...</p>
              </div>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {/* Step 2: Amount */}
          {step === 2 && (
            <div className="space-y-5">
              {merchantName && (
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Recebedor</p>
                  <p className="text-sm font-medium">{merchantName}</p>
                  {merchantCity && <p className="text-xs text-muted-foreground">{merchantCity}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="qr-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="qr-amount"
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
                onClick={handleStep2}
                disabled={!amount || parseLocalizedNumber(amount) <= 0}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                {merchantName && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recebedor</p>
                      <p className="text-sm font-medium break-words mt-1">{merchantName}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}
                {pixKey && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chave Pix</p>
                      <p className="text-sm font-medium break-all mt-1">{pixKey}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valor</p>
                  <p className="text-lg font-bold text-primary mt-1">{formattedAmount()}</p>
                </div>
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
