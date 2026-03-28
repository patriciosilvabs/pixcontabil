import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Key, DollarSign, CheckCircle2, ShieldCheck, UserCheck, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { useAuth } from "@/contexts/AuthContext";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";
import { PaymentStatusScreen } from "./PaymentStatusScreen";

interface PixKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

const keyTypePlaceholders: Record<PixKeyType, string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "exemplo@email.com",
  phone: "+5511999999999",
  random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
};

const keyTypeLabels: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave aleatória",
};

function maskDocument(doc: string | null): string {
  if (!doc) return "";
  const clean = doc.replace(/\D/g, "");
  if (clean.length === 11) {
    return `***${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
  }
  if (clean.length === 14) {
    return `**.***.${clean.slice(4, 7)}/${clean.slice(7, 11)}-**`;
  }
  return doc;
}

export function PixKeyDialog({ open, onOpenChange }: PixKeyDialogProps) {
  const navigate = useNavigate();
  const { payByKey, checkStatus, getTransactionBeneficiary, isProcessing } = usePixPayment();
  const { hasPageAccess } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("cpf");
  const [pixKey, setPixKey] = useState("");
  const [amount, setAmount] = useState("");
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [description, setDescription] = useState("");

  // Probe state
  const [probeTransactionId, setProbeTransactionId] = useState("");
  const [probeError, setProbeError] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState<string | null>(null);
  const [beneficiaryDocument, setBeneficiaryDocument] = useState<string | null>(null);
  const probePollingRef = useRef<NodeJS.Timeout | null>(null);
  const probeMountedRef = useRef(true);

  // Real payment state
  const [realTransactionId, setRealTransactionId] = useState("");

  const handleClose = () => {
    stopProbePolling();
    setPixKeyType("cpf");
    setPixKey("");
    setAmount("");
    setDescription("");
    setSaveFavorite(false);
    setStep(1);
    setProbeTransactionId("");
    setProbeError("");
    setBeneficiaryName(null);
    setBeneficiaryDocument(null);
    setRealTransactionId("");
    onOpenChange(false);
  };

  const handleCloseAndNavigate = () => {
    handleClose();
    const nextRoute = hasPageAccess("transactions") ? "/transactions" : "/";
    navigate(nextRoute);
  };

  const stopProbePolling = useCallback(() => {
    if (probePollingRef.current) {
      clearInterval(probePollingRef.current);
      probePollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    probeMountedRef.current = true;
    return () => {
      probeMountedRef.current = false;
      stopProbePolling();
    };
  }, [stopProbePolling]);

  const handleBack = () => {
    if (step === 1 || step === 6) {
      handleClose();
    } else if (step === 3) {
      // Can't go back during probe
      return;
    } else if (step === 4) {
      // Cancel after seeing beneficiary — go back to step 2
      setStep(2);
    } else if (step === 5) {
      // Can't go back during real payment
      return;
    } else {
      setStep((s) => (s - 1) as Step);
    }
  };

  const handleStep1 = () => {
    const trimmed = pixKey.trim();
    if (!trimmed) {
      toast.error("Informe a chave Pix");
      return;
    }
    setStep(2);
  };

  // Step 2 → directly triggers probe
  const handleStep2 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    if (!description.trim()) {
      toast.error("Informe a descrição do pagamento");
      return;
    }
    startProbe();
  };

  // Step 3: Send R$0.01 probe and poll for completion
  const startProbe = async () => {
    setStep(3);
    setProbeError("");
    setBeneficiaryName(null);
    setBeneficiaryDocument(null);

    const result = await payByKey({
      pix_key: pixKey.trim(),
      valor: 0.01,
      descricao: "Verificação de beneficiário",
    });

    if (!result?.transaction_id) {
      setProbeError("Não foi possível verificar o beneficiário. Tente novamente.");
      return;
    }

    setProbeTransactionId(result.transaction_id);
    pollProbe(result.transaction_id);
  };

  const pollProbe = (txId: string) => {
    let attempts = 0;
    const maxAttempts = 90;

    const doPoll = async () => {
      if (!probeMountedRef.current) return;
      attempts++;

      try {
        const statusResult = await checkStatus(txId, true);
        if (!probeMountedRef.current) return;

        if (statusResult?.is_completed || statusResult?.internal_status === "completed") {
          stopProbePolling();
          let bene: { name: string | null; document: string | null } | null = null;
          for (let retry = 0; retry < 5; retry++) {
            bene = await getTransactionBeneficiary(txId);
            if (bene?.name) break;
            await new Promise(r => setTimeout(r, 1000));
          }
          if (probeMountedRef.current) {
            setBeneficiaryName(bene?.name || null);
            setBeneficiaryDocument(bene?.document || null);
            setStep(4);
          }
          return;
        }

        if (statusResult?.internal_status === "failed") {
          stopProbePolling();
          if (probeMountedRef.current) {
            setProbeError(statusResult.error_code || "A verificação falhou. Tente novamente.");
          }
          return;
        }

        if (attempts >= maxAttempts) {
          stopProbePolling();
          if (probeMountedRef.current) {
            setProbeError("Tempo esgotado aguardando confirmação da verificação.");
          }
        }
      } catch {
        if (attempts >= maxAttempts && probeMountedRef.current) {
          stopProbePolling();
          setProbeError("Erro ao verificar status da transação de verificação.");
        }
      }
    };

    doPoll();
    probePollingRef.current = setInterval(doPoll, 2000);
  };

  // Step 5: Send real payment
  const handleConfirmRealPayment = async () => {
    setStep(5);
    const value = parseLocalizedNumber(amount);

    const result = await payByKey({
      pix_key: pixKey.trim(),
      valor: value,
      descricao: description.trim() || undefined,
    });

    if (result?.transaction_id) {
      setRealTransactionId(result.transaction_id);
      setStep(6);
    } else {
      setStep(4);
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const stepIcons = [Key, DollarSign, ShieldCheck, UserCheck, CreditCard, CheckCircle2];
  const stepTitles = [
    "Pix com Chave",
    "Valor do Pagamento",
    "Verificando Beneficiário",
    "Confirmar Beneficiário",
    "Processando Pagamento",
    "Status do Pagamento",
  ];
  const totalSteps = 6;
  const StepIcon = stepIcons[step - 1];
  const stepTitle = stepTitles[step - 1];

  const showHeader = step !== 6;

  return (
    <Drawer open={open} onOpenChange={step >= 3 && step <= 5 ? undefined : handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          {showHeader && (
            <>
              <DrawerHeader className="flex-row items-center gap-3 p-0 pb-5">
                <button onClick={handleBack} className="p-1 -ml-1" disabled={step === 3 || step === 5}>
                  <ArrowLeft className={`h-5 w-5 ${step === 3 || step === 5 ? "opacity-30" : ""}`} />
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

              <div className="flex gap-1.5 mb-5">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
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

          {/* Step 1: Key type + Pix Key */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Tipo de Chave
                </Label>
                <Select value={pixKeyType} onValueChange={(v) => setPixKeyType(v as PixKeyType)}>
                  <SelectTrigger className="h-12 text-base" data-vaul-no-drag>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(keyTypeLabels) as PixKeyType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {keyTypeLabels[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pix-key" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Chave Pix
                </Label>
                <Input
                  id="pix-key"
                  placeholder={keyTypePlaceholders[pixKeyType]}
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className="h-12 text-base"
                  data-vaul-no-drag
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
                onClick={handleStep1}
                disabled={!pixKey.trim()}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Amount + Description */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-lg bg-secondary/50 p-3 flex items-center gap-3">
                <Key className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-medium truncate">{pixKey}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pix-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="pix-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-14 text-2xl font-bold text-center"
                  data-vaul-no-drag
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pix-description" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição *
                </Label>
                <Textarea
                  id="pix-description"
                  placeholder="Ex: Pagamento fornecedor"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 140))}
                  className="text-sm resize-none"
                  rows={2}
                  maxLength={140}
                  data-vaul-no-drag
                />
                <p className="text-xs text-muted-foreground text-right">{description.length}/140</p>
              </div>

              <Button
                onClick={handleStep2}
                disabled={!amount || parseLocalizedNumber(amount) <= 0 || !description.trim()}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 3: Verifying beneficiary (probe R$0.01) */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-4 py-6">
              {probeError ? (
                <>
                  <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
                    <ShieldCheck className="h-8 w-8 text-destructive" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Falha na verificação</p>
                    <p className="text-sm text-muted-foreground">{probeError}</p>
                  </div>
                  <Button
                    onClick={() => { setProbeError(""); startProbe(); }}
                    className="w-full h-12 text-base font-bold uppercase tracking-wider"
                  >
                    Tentar Novamente
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleClose}
                    className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Consultando transação ...</p>
                    <p className="text-sm text-muted-foreground">
                      Aguarde enquanto consultamos os dados da transação.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Confirm beneficiary */}
          {step === 4 && (
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <UserCheck className="h-9 w-9 text-primary" />
              </div>

              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">O beneficiário desta chave é:</p>
                <p className="text-xl font-bold">{beneficiaryName || "Não identificado"}</p>
              </div>

              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">Deseja prosseguir com o pagamento de</p>
                <p className="text-2xl font-bold text-primary">{formattedAmount()}</p>
              </div>

              <div className="w-full space-y-2 mt-2">
                <Button
                  onClick={handleConfirmRealPayment}
                  disabled={isProcessing}
                  className="w-full h-12 text-base font-bold uppercase tracking-wider"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Processando...
                    </>
                  ) : (
                    "Confirmar e Pagar"
                  )}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleClose}
                  className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Processing real payment */}
          {step === 5 && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-base font-bold">Enviando pagamento</p>
                <p className="text-sm text-muted-foreground">
                  Processando {formattedAmount()} para {beneficiaryName || pixKey}...
                </p>
              </div>
            </div>
          )}

          {/* Step 6: Status verification of real payment */}
          {step === 6 && realTransactionId && (
            <PaymentStatusScreen
              transactionId={realTransactionId}
              amount={parseLocalizedNumber(amount)}
              beneficiaryName={beneficiaryName || pixKey}
              onClose={handleCloseAndNavigate}
              redirectToReceiptCapture={false}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
