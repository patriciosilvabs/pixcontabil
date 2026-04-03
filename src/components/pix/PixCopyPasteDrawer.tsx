import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, ClipboardPaste, CheckCircle2, Clipboard } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { parseLocalizedNumber } from "@/lib/utils";
import { PaymentStatusScreen } from "./PaymentStatusScreen";
import { supabase } from "@/integrations/supabase/client";
import { useQuickTags, QuickTag } from "@/hooks/useQuickTags";
import { QuickTagsSection } from "@/components/payment/QuickTagsSection";

interface PixCopyPasteDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PixCopyPasteDrawer({ open, onOpenChange }: PixCopyPasteDrawerProps) {
  const navigate = useNavigate();
  const { getQRCodeInfo, payByQRCode, isProcessing } = usePixPayment();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [emvCode, setEmvCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [merchantCity, setMerchantCity] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [description, setDescription] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [showOrderInput, setShowOrderInput] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [descriptionPlaceholder, setDescriptionPlaceholder] = useState("Ex: Pagamento fornecedor");
  const [descriptionRequired, setDescriptionRequired] = useState(true);
  const { tags: quickTags } = useQuickTags("copy_paste");

  const reset = () => {
    setStep(1);
    setEmvCode("");
    setIsLoading(false);
    setAmount("");
    setMerchantName("");
    setMerchantCity("");
    setPixKey("");
    setTransactionId("");
    setDescription("");
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(reset, 300);
  };

  const handleBack = () => {
    if (step === 1) {
      handleClose();
    } else if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(1);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setEmvCode(text.trim());
      } else {
        toast.error("Área de transferência vazia");
      }
    } catch {
      toast.error("Não foi possível acessar a área de transferência. Cole manualmente.");
    }
  };

  const handleContinue = async () => {
    const code = emvCode.trim();
    if (!code) {
      toast.error("Cole ou digite o código Pix");
      return;
    }

    setStep(2);
    setIsLoading(true);

    const info = await getQRCodeInfo({ qr_code: code });
    setIsLoading(false);

    if (info) {
      setMerchantName(info.merchant_name || "");
      setMerchantCity(info.merchant_city || "");
      setPixKey(info.pix_key || "");

      if (info.amount && info.amount > 0) {
        setAmount(info.amount.toFixed(2).replace(".", ","));
        setStep(3);
      } else {
        toast.error("Este código Pix não contém valor. Verifique o código e tente novamente.");
        setStep(1);
      }
    } else {
      toast.error("Não foi possível ler os dados do código Pix. Verifique o código e tente novamente.");
      setStep(1);
    }
  };

  const handleConfirm = async () => {
    if (!description.trim()) {
      toast.error("Informe a descrição do pagamento");
      return;
    }

    const value = parseLocalizedNumber(amount);
    const result = await payByQRCode({
      qr_code: emvCode.trim(),
      valor: value,
    });

    if (result?.transaction_id) {
      try {
        await supabase
          .from("transactions")
          .update({ description: description.trim() } as any)
          .eq("id", result.transaction_id);
      } catch (e) {
        console.error("[PixCopyPasteDrawer] Failed to update transaction metadata:", e);
      }
      setTransactionId(result.transaction_id);
      setStep(4);
    }
  };

  const handleCloseAndNavigate = () => {
    handleClose();
    navigate("/transactions");
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const stepIcon = step === 1 ? ClipboardPaste : step === 2 ? ClipboardPaste : CheckCircle2;
  const stepTitle = step === 1 ? "Copia e Cola" : step === 2 ? "Consultando..." : step === 3 ? "Confirmar Pagamento" : "Status";
  const StepIcon = stepIcon;

  return (
    <Drawer open={open} onOpenChange={step === 4 ? undefined : handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          {step !== 4 && (
            <>
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

              {/* Step indicators — 3 steps */}
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
            </>
          )}

          {/* Step 1: Paste EMV code */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Código Pix (EMV)
                </Label>
                <Textarea
                  placeholder="Cole aqui o código Pix Copia e Cola..."
                  value={emvCode}
                  onChange={(e) => setEmvCode(e.target.value)}
                  className="min-h-[100px] text-sm"
                  autoFocus
                />
              </div>

              <Button
                variant="outline"
                onClick={handlePaste}
                className="w-full h-10 gap-2 text-sm font-semibold"
              >
                <Clipboard className="h-4 w-4" />
                Colar
              </Button>

              <Button
                onClick={handleContinue}
                disabled={!emvCode.trim()}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Loading */}
          {step === 2 && isLoading && (
            <div className="space-y-4 py-6">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Consultando dados do código Pix...</p>
              </div>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && (
            <div className="space-y-5 max-h-[60vh] overflow-y-auto">
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

              {/* Description */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição *
                </Label>
                <Textarea
                  placeholder="Ex: Pagamento fornecedor"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[60px] text-sm"
                  data-vaul-no-drag
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

          {/* Step 4: Status verification */}
          {step === 4 && transactionId && (
            <PaymentStatusScreen
              transactionId={transactionId}
              amount={parseLocalizedNumber(amount)}
              beneficiaryName={merchantName || pixKey}
              onClose={handleCloseAndNavigate}
              redirectToReceiptCapture={true}
              skipReceiptCapture={false}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
